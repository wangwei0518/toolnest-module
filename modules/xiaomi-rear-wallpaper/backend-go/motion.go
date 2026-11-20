package main

import (
	"bytes"
	"encoding/binary"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strconv"
)

const xmpIdentifier = "http://ns.adobe.com/xap/1.0/\x00"

func validMP4(video []byte) bool {
	return len(video) >= 16 && string(video[4:8]) == "ftyp" && len(bytes.TrimSpace(video[8:12])) > 0
}

func embeddedMotion(source []byte) ([]byte, *int64, error) {
	if len(source) < 4 || source[0] != 0xff || source[1] != 0xd8 {
		return nil, nil, nil
	}
	for p := 2; p+4 <= min(len(source), 512_000) && source[p] == 0xff; {
		marker := source[p+1]
		if marker == 0xff {
			p++
			continue
		}
		if marker == 0xda || marker == 0xd9 {
			break
		}
		n := int(binary.BigEndian.Uint16(source[p+2:]))
		if n < 2 || n > len(source)-p-2 {
			break
		}
		block := source[p+4 : p+2+n]
		if marker == 0xe1 && bytes.HasPrefix(block, []byte(xmpIdentifier)) {
			return parseMotionXMP(block[len(xmpIdentifier):], source)
		}
		p += n + 2
	}
	return nil, nil, nil
}

func parseMotionXMP(packet, source []byte) ([]byte, *int64, error) {
	decoder := xml.NewDecoder(bytes.NewReader(packet))
	enabled := false
	var length int
	var stamp *int64
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, nil, errors.New("动态照片元数据无效。")
		}
		node, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		var mime, semantic, size string
		for _, attr := range node.Attr {
			switch attr.Name.Local {
			case "MotionPhoto":
				if attr.Value == "1" {
					enabled = true
				}
			case "MotionPhotoPresentationTimestampUs":
				value, err := strconv.ParseInt(attr.Value, 10, 64)
				if err != nil || value < -1 || value > 9_007_199_254_740_991 {
					return nil, nil, errors.New("动态照片的关键帧时间无效。")
				}
				stamp = &value
			case "Mime":
				mime = attr.Value
			case "Semantic":
				semantic = attr.Value
			case "Length":
				size = attr.Value
			}
		}
		if mime == "video/mp4" && semantic == "MotionPhoto" {
			length, _ = strconv.Atoi(size)
		}
	}
	if !enabled {
		return nil, nil, nil
	}
	if length <= 0 || length > len(source) || !validMP4(source[len(source)-length:]) {
		return nil, nil, errors.New("未能在动态照片中定位视频内容，请选择完整的安卓 Live Photo JPG。")
	}
	return source[len(source)-length:], stamp, nil
}

func packageMotion(w io.Writer, jpeg, video []byte, stamp *int64) error {
	if len(jpeg) < 4 || !bytes.HasPrefix(jpeg, []byte{0xff, 0xd8}) || !bytes.HasSuffix(jpeg, []byte{0xff, 0xd9}) || !validMP4(video) {
		return errors.New("无法封装动态照片。")
	}
	timestamp := ""
	if stamp != nil {
		timestamp = fmt.Sprintf(" GCamera:MotionPhotoPresentationTimestampUs=\"%d\"", *stamp)
	}
	packet := []byte(fmt.Sprintf(`%s<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" GCamera:MotionPhoto="1" GCamera:MotionPhotoVersion="1"%s><Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0"/></rdf:li><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="%d"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>`, xmpIdentifier, timestamp, len(video)))
	length := len(packet) + 2
	for _, part := range [][]byte{jpeg[:2], {0xff, 0xe1, byte(length >> 8), byte(length)}, packet, jpeg[2:], video} {
		if _, err := w.Write(part); err != nil {
			return err
		}
	}
	return nil
}
