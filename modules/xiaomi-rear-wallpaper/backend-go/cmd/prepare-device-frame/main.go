package main

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"log"
	"os"
)

func prepare() error {
	input, err := os.Open("../frontend/assets/xiaomi-rear-display-reference.png")
	if err != nil {
		return err
	}
	defer input.Close()
	src, err := png.Decode(input)
	if err != nil {
		return err
	}
	bounds := src.Bounds()
	if bounds != image.Rect(0, 0, 1211, 2512) {
		return fmt.Errorf("设备示意图尺寸与 device-profile 不一致: %v", bounds)
	}
	dst := image.NewNRGBA(bounds)
	draw.Draw(dst, bounds, src, bounds.Min, draw.Src)
	// Bounds and seed match the display geometry in frontend/src/lib/device-profile.ts.
	region := image.Rect(100, 90, 1112, 736)
	queue := make([]image.Point, 0, region.Dx()*region.Dy())
	enqueue := func(p image.Point) {
		if !p.In(region) {
			return
		}
		c := dst.NRGBAAt(p.X, p.Y)
		low, high := min(c.R, c.G, c.B), max(c.R, c.G, c.B)
		if c.A == 0 || low < 185 || high-low > 24 {
			return
		}
		dst.SetNRGBA(p.X, p.Y, color.NRGBA{R: c.R, G: c.G, B: c.B})
		queue = append(queue, p)
	}
	enqueue(image.Pt(606, 150))
	for i := 0; i < len(queue); i++ {
		p := queue[i]
		enqueue(p.Add(image.Pt(-1, 0)))
		enqueue(p.Add(image.Pt(1, 0)))
		enqueue(p.Add(image.Pt(0, -1)))
		enqueue(p.Add(image.Pt(0, 1)))
	}
	if len(queue) == 0 {
		return fmt.Errorf("设备示意图遮罩区域为空")
	}
	output, err := os.Create("../frontend/src/assets/xiaomi-rear-display-frame.png")
	if err != nil {
		return err
	}
	encoder := png.Encoder{CompressionLevel: png.BestCompression}
	err = encoder.Encode(output, dst)
	closeErr := output.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func main() {
	if err := prepare(); err != nil {
		log.Fatal(err)
	}
}
