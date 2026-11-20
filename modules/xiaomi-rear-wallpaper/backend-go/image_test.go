package main

import (
	"bytes"
	"encoding/hex"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"testing"

	"golang.org/x/image/webp"
)

func TestStillPipeline(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 160, 100))
	source.SetNRGBA(80, 50, color.NRGBA{R: 254, A: 255})
	var input bytes.Buffer
	if err := png.Encode(&input, source); err != nil {
		t.Fatal(err)
	}
	info, err := inspectImage(input.Bytes())
	if err != nil || info.width != 160 || info.height != 100 || info.format != "png" {
		t.Fatalf("%+v: %v", info, err)
	}
	crop, err := normalizeCrop(nil, info.width, info.height)
	if err != nil {
		t.Fatal(err)
	}
	still, err := decodeStill(input.Bytes(), info)
	if err != nil {
		t.Fatal(err)
	}
	var output, preview bytes.Buffer
	if err := encodeStill(&output, still, crop, false); err != nil {
		t.Fatal(err)
	}
	if err := encodePreview(&preview, still, crop); err != nil {
		t.Fatal(err)
	}
	cfg, err := png.DecodeConfig(&output)
	if err != nil || cfg.Width != 976 || cfg.Height != 596 {
		t.Fatalf("%+v: %v", cfg, err)
	}
	cfg, err = webp.DecodeConfig(&preview)
	if err != nil || cfg.Width != 480 || cfg.Height != 293 {
		t.Fatalf("%+v: %v", cfg, err)
	}
}

func TestOrientationAndEmbeddedMotion(t *testing.T) {
	raw := image.NewNRGBA(image.Rect(0, 0, 160, 100))
	raw.SetNRGBA(0, 99, color.NRGBA{R: 255, A: 255})
	view := orientedImage{raw, 6}
	if view.Bounds() != image.Rect(0, 0, 100, 160) || view.At(0, 0) != raw.At(0, 99) {
		t.Fatal("clockwise EXIF transform is incorrect")
	}
	var jpegData bytes.Buffer
	if err := jpeg.Encode(&jpegData, raw, nil); err != nil {
		t.Fatal(err)
	}
	original := jpegData.Bytes()
	exif, _ := hex.DecodeString("45786966000049492a0008000000010012010300010000000600000000000000")
	withExif := append([]byte{0xff, 0xd8, 0xff, 0xe1, 0, byte(len(exif) + 2)}, exif...)
	withExif = append(withExif, original[2:]...)
	info, err := inspectImage(withExif)
	if err != nil || info.width != 100 || info.height != 160 || info.orientation != 6 {
		t.Fatalf("%+v: %v", info, err)
	}
	video := []byte{0, 0, 0, 16, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 0, 0}
	stamp := int64(123456)
	var output bytes.Buffer
	if err := packageMotion(&output, withExif, video, &stamp); err != nil {
		t.Fatal(err)
	}
	got, timestamp, err := embeddedMotion(output.Bytes())
	if err != nil || timestamp == nil || *timestamp != stamp || !bytes.Equal(got, video) {
		t.Fatalf("round trip failed: %v %v", timestamp, err)
	}
	if _, _, err := embeddedMotion(output.Bytes()[:output.Len()-4]); err == nil {
		t.Fatal("truncated motion was accepted")
	}
}

func TestLegacyGIFExport(t *testing.T) {
	palette := color.Palette{color.Transparent, color.RGBA{R: 255, A: 255}, color.RGBA{B: 255, A: 255}}
	frame := image.NewPaletted(image.Rect(0, 0, 16, 10), palette)
	frame.SetColorIndex(0, 0, 1)
	second := image.NewPaletted(image.Rect(0, 0, 8, 8), palette)
	second.SetColorIndex(0, 0, 2)
	var original bytes.Buffer
	err := gif.EncodeAll(&original, &gif.GIF{Image: []*image.Paletted{frame, second}, Delay: []int{10, 20}, LoopCount: 3, Disposal: []byte{gif.DisposalNone, gif.DisposalPrevious}})
	if err != nil {
		t.Fatal(err)
	}
	data := original.Bytes()
	info, err := inspectImage(data)
	if err != nil {
		t.Fatal(err)
	}
	count, err := gifFrameCount(data, info.width, info.height)
	if err != nil || count != 2 {
		t.Fatalf("%d: %v", count, err)
	}
	crop, err := normalizeCrop(nil, info.width, info.height)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	preview, err := renderGIF(data, info, crop, &output)
	if err != nil {
		t.Fatal(err)
	}
	animation, err := gif.DecodeAll(&output)
	if err != nil {
		t.Fatal(err)
	}
	if len(animation.Image) != 2 || animation.Delay[1] != 20 || animation.LoopCount != 3 || animation.Config.Width != 976 || animation.Config.Height != 596 || preview.Bounds().Dx() != 480 {
		t.Fatal("legacy GIF geometry, timing, or looping changed")
	}
}
