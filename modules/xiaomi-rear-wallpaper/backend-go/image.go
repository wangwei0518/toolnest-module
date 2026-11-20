package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/color/palette"
	"image/draw"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"math"

	"github.com/gen2brain/webp"
	scale "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	targetWidth  = 976
	targetHeight = 596
	maxUpload    = 30 << 20
	maxPixels    = 80_000_000
)

type cropRect struct {
	Left   float64 `json:"left"`
	Top    float64 `json:"top"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

func normalizeCrop(crop *cropRect, width, height int) (cropRect, error) {
	target := float64(targetWidth) / targetHeight
	ratio := float64(width) / float64(height)
	if crop == nil {
		if ratio > target {
			w := target / ratio
			return cropRect{Left: (1 - w) / 2, Width: w, Height: 1}, nil
		}
		h := ratio / target
		return cropRect{Top: (1 - h) / 2, Width: 1, Height: h}, nil
	}
	c := *crop
	if c.Left < 0 || c.Top < 0 || c.Width <= 0 || c.Height <= 0 ||
		c.Left+c.Width > 1.00001 || c.Top+c.Height > 1.00001 ||
		math.Abs(c.Width/c.Height*ratio/target-1) > 0.025 {
		return cropRect{}, errors.New("裁切范围无效，请重新调整图片。")
	}
	return c, nil
}

type imageInfo struct {
	width, height, orientation int
	format                     string
}

func inspectImage(data []byte) (imageInfo, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return imageInfo{}, err
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > 16000 || cfg.Height > 16000 ||
		int64(cfg.Width)*int64(cfg.Height) > maxPixels {
		return imageInfo{}, errImageSize
	}
	o := orientation(exifBlock(data, format))
	w, h := cfg.Width, cfg.Height
	if o >= 5 {
		w, h = h, w
	}
	if format == "jpeg" {
		format = "jpg"
	}
	return imageInfo{w, h, o, format}, nil
}

var errImageSize = errors.New("图片尺寸或像素量过大，请缩小图片后重试。")

func scaledCrop(src image.Image, crop cropRect, width, height int) *image.NRGBA {
	b := src.Bounds()
	x := min(b.Dx()-1, max(0, int(math.Round(crop.Left*float64(b.Dx())))))
	y := min(b.Dy()-1, max(0, int(math.Round(crop.Top*float64(b.Dy())))))
	w := min(b.Dx()-x, max(1, int(math.Round(crop.Width*float64(b.Dx())))))
	h := min(b.Dy()-y, max(1, int(math.Round(crop.Height*float64(b.Dy())))))
	rect := image.Rect(x, y, x+w, y+h).Add(b.Min)
	dst := image.NewNRGBA(image.Rect(0, 0, width, height))
	scale.CatmullRom.Scale(dst, dst.Bounds(), src, rect, draw.Src, nil)
	return dst
}

// An image view avoids allocating a full-size copy during EXIF transforms.
type orientedImage struct {
	image.Image
	o int
}

func (v orientedImage) Bounds() image.Rectangle {
	b := v.Image.Bounds()
	if v.o >= 5 {
		return image.Rect(0, 0, b.Dy(), b.Dx())
	}
	return image.Rect(0, 0, b.Dx(), b.Dy())
}
func (v orientedImage) At(x, y int) color.Color {
	b := v.Image.Bounds()
	w, h := b.Dx(), b.Dy()
	switch v.o {
	case 2:
		x = w - 1 - x
	case 3:
		x, y = w-1-x, h-1-y
	case 4:
		y = h - 1 - y
	case 5:
		x, y = y, x
	case 6:
		x, y = y, h-1-x
	case 7:
		x, y = w-1-y, h-1-x
	case 8:
		x, y = w-1-y, x
	}
	return v.Image.At(x+b.Min.X, y+b.Min.Y)
}

func exifBlock(data []byte, format string) []byte {
	switch format {
	case "jpeg":
		for p := 2; p+4 <= len(data) && data[p] == 0xff; {
			marker := data[p+1]
			if marker == 0xff {
				p++
				continue
			}
			if marker == 0xda || marker == 0xd9 {
				break
			}
			n := int(binary.BigEndian.Uint16(data[p+2:]))
			if n < 2 || n > len(data)-p-2 {
				break
			}
			block := data[p+4 : p+2+n]
			if marker == 0xe1 && bytes.HasPrefix(block, []byte("Exif\x00\x00")) {
				return block[6:]
			}
			p += 2 + n
		}
	case "png":
		for p := 8; p+12 <= len(data); {
			n := int64(binary.BigEndian.Uint32(data[p:]))
			if n > int64(len(data)-p-12) {
				break
			}
			if string(data[p+4:p+8]) == "eXIf" {
				return data[p+8 : p+8+int(n)]
			}
			p += int(n) + 12
		}
	case "webp":
		for p := 12; p+8 <= len(data); {
			n := int64(binary.LittleEndian.Uint32(data[p+4:]))
			if n > int64(len(data)-p-8) {
				break
			}
			if string(data[p:p+4]) == "EXIF" {
				return bytes.TrimPrefix(data[p+8:p+8+int(n)], []byte("Exif\x00\x00"))
			}
			p += 8 + int(n) + (int(n) & 1)
		}
	}
	return nil
}

func orientation(tiff []byte) int {
	if len(tiff) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	if order.Uint16(tiff[2:]) != 42 {
		return 1
	}
	offset := int64(order.Uint32(tiff[4:]))
	if offset > int64(len(tiff)-2) {
		return 1
	}
	rest := tiff[offset:]
	count := int(order.Uint16(rest))
	rest = rest[2:]
	for i := 0; i < min(count, len(rest)/12); i++ {
		entry := rest[i*12:]
		if order.Uint16(entry) == 0x112 && order.Uint16(entry[2:]) == 3 && order.Uint32(entry[4:]) == 1 {
			value := int(order.Uint16(entry[8:]))
			if value >= 1 && value <= 8 {
				return value
			}
		}
	}
	return 1
}

func decodeStill(data []byte, info imageInfo) (image.Image, error) {
	var src image.Image
	var err error
	if info.format == "webp" {
		src, err = webp.Decode(bytes.NewReader(data))
	} else {
		src, _, err = image.Decode(bytes.NewReader(data))
	}
	if err != nil {
		return nil, err
	}
	if info.orientation == 1 {
		return src, nil
	}
	return orientedImage{src, info.orientation}, nil
}

func encodePreview(w io.Writer, src image.Image, crop cropRect) error {
	preview := scaledCrop(src, crop, 480, 293)
	return webp.Encode(w, preview, webp.Options{Quality: 78})
}

func encodeStill(w io.Writer, src image.Image, crop cropRect, motion bool) error {
	output := scaledCrop(src, crop, targetWidth, targetHeight)
	if motion {
		return jpeg.Encode(w, output, &jpeg.Options{Quality: 94})
	}
	return png.Encode(w, output)
}

// Validate GIF frame and canvas budgets before gif.DecodeAll allocates frame buffers.
func gifFrameCount(data []byte, width, height int) (int, error) {
	if len(data) < 13 {
		return 0, io.ErrUnexpectedEOF
	}
	p := 13
	if data[10]&0x80 != 0 {
		p += 3 << (1 + (data[10] & 7))
	}
	skipBlocks := func() bool {
		for p < len(data) {
			n := int(data[p])
			p++
			if n == 0 {
				return true
			}
			if n > len(data)-p {
				return false
			}
			p += n
		}
		return false
	}
	frames := 0
	for p < len(data) {
		kind := data[p]
		p++
		switch kind {
		case 0x3b:
			if frames > 0 {
				return frames, nil
			}
			return 0, errors.New("GIF 没有有效帧。")
		case 0x21:
			if p >= len(data) {
				return 0, io.ErrUnexpectedEOF
			}
			p++
		case 0x2c:
			if p+9 > len(data) {
				return 0, io.ErrUnexpectedEOF
			}
			x := int(binary.LittleEndian.Uint16(data[p:]))
			y := int(binary.LittleEndian.Uint16(data[p+2:]))
			w := int(binary.LittleEndian.Uint16(data[p+4:]))
			h := int(binary.LittleEndian.Uint16(data[p+6:]))
			if w <= 0 || h <= 0 || x+w > width || y+h > height {
				return 0, errors.New("GIF 帧尺寸无效。")
			}
			flags := data[p+8]
			p += 9
			if flags&0x80 != 0 {
				p += 3 << (1 + (flags & 7))
			}
			p++
			frames++
			if frames > 120 || int64(width)*int64(height)*int64(frames) > maxPixels {
				return 0, errImageSize
			}
		default:
			return 0, errors.New("GIF 帧格式无效。")
		}
		if !skipBlocks() {
			return 0, io.ErrUnexpectedEOF
		}
	}
	return 0, io.ErrUnexpectedEOF
}

func renderGIF(data []byte, info imageInfo, crop cropRect, output io.Writer) (image.Image, error) {
	if _, err := gifFrameCount(data, info.width, info.height); err != nil {
		return nil, err
	}
	animation, err := gif.DecodeAll(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	canvas := image.NewNRGBA(image.Rect(0, 0, info.width, info.height))
	result := &gif.GIF{Delay: animation.Delay, LoopCount: animation.LoopCount, Config: image.Config{Width: targetWidth, Height: targetHeight}}
	var first image.Image
	for i, frame := range animation.Image {
		var disposal byte
		if i < len(animation.Disposal) {
			disposal = animation.Disposal[i]
		}
		var previous *image.NRGBA
		if disposal == gif.DisposalPrevious {
			previous = image.NewNRGBA(canvas.Bounds())
			copy(previous.Pix, canvas.Pix)
		}
		draw.Draw(canvas, frame.Bounds(), frame, frame.Bounds().Min, draw.Over)
		if i == 0 {
			first = scaledCrop(canvas, crop, 480, 293)
		}
		pix := scaledCrop(canvas, crop, targetWidth, targetHeight)
		// Reserve one palette entry so transparent GIF frames stay transparent.
		colors := append(color.Palette{color.Transparent}, palette.Plan9[:255]...)
		paletted := image.NewPaletted(pix.Bounds(), colors)
		draw.FloydSteinberg.Draw(paletted, pix.Bounds(), pix, image.Point{})
		for y := range pix.Bounds().Dy() {
			for x := range pix.Bounds().Dx() {
				if pix.NRGBAAt(x, y).A < 128 {
					paletted.SetColorIndex(x, y, 0)
				}
			}
		}
		result.Image = append(result.Image, paletted)
		result.Disposal = append(result.Disposal, gif.DisposalBackground)
		switch disposal {
		case gif.DisposalBackground:
			draw.Draw(canvas, frame.Bounds(), image.Transparent, image.Point{}, draw.Src)
		case gif.DisposalPrevious:
			canvas = previous
		}
	}
	return first, gif.EncodeAll(output, result)
}
