package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
	smithyhttp "github.com/aws/smithy-go/transport/http"
)

type r2Storage struct {
	bucket  *string
	client  *s3.Client
	presign *s3.PresignClient
}

func newR2(cfg r2Config, endpoint string, client *http.Client) *r2Storage {
	s := s3.New(s3.Options{
		Region: "auto", BaseEndpoint: aws.String(endpoint), Credentials: credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		HTTPClient: client, RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
	})
	return &r2Storage{bucket: aws.String(cfg.Bucket), client: s, presign: s3.NewPresignClient(s)}
}

func r2Error(err error) error {
	var api smithy.APIError
	if errors.As(err, &api) && api.ErrorCode() == "NoSuchUpload" {
		return errNoUpload
	}
	return err
}

func (s *r2Storage) start(ctx context.Context, key, name string) (string, error) {
	out, err := s.client.CreateMultipartUpload(ctx, &s3.CreateMultipartUploadInput{Bucket: s.bucket, Key: &key,
		ContentType: aws.String("application/octet-stream"), ContentDisposition: aws.String(disposition(name)), CacheControl: aws.String("private, no-store")})
	if err != nil {
		return "", err
	}
	if aws.ToString(out.UploadId) == "" {
		return "", fmt.Errorf("R2 did not return an upload ID")
	}
	return *out.UploadId, nil
}

func (s *r2Storage) putEmpty(ctx context.Context, key, name string) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{Bucket: s.bucket, Key: &key, ContentLength: aws.Int64(0), Body: bytes.NewReader(nil),
		ContentType: aws.String("application/octet-stream"), ContentDisposition: aws.String(disposition(name)), CacheControl: aws.String("private, no-store")})
	return err
}

func (s *r2Storage) signPart(ctx context.Context, key, id string, index int, size int64) (string, error) {
	req, err := s.presign.PresignUploadPart(ctx, &s3.UploadPartInput{Bucket: s.bucket, Key: &key, UploadId: &id, PartNumber: aws.Int32(int32(index)), ContentLength: &size},
		s3.WithPresignExpires(5*time.Minute))
	if err != nil {
		return "", err
	}
	return req.URL, nil
}

func (s *r2Storage) parts(ctx context.Context, key, id string) ([]part, error) {
	pages := s3.NewListPartsPaginator(s.client, &s3.ListPartsInput{Bucket: s.bucket, Key: &key, UploadId: &id})
	parts := make([]part, 0)
	for pages.HasMorePages() {
		out, err := pages.NextPage(ctx)
		if err != nil {
			return nil, r2Error(err)
		}
		for _, p := range out.Parts {
			if p.PartNumber == nil || p.Size == nil || aws.ToString(p.ETag) == "" {
				return nil, fmt.Errorf("incomplete R2 part")
			}
			parts = append(parts, part{int(*p.PartNumber), *p.ETag, *p.Size})
		}
		if len(parts) > 10000 {
			return nil, fmt.Errorf("too many R2 parts")
		}
		if aws.ToBool(out.IsTruncated) && aws.ToString(out.NextPartNumberMarker) == "" {
			return nil, fmt.Errorf("missing R2 part marker")
		}
	}
	return parts, nil
}

func (s *r2Storage) complete(ctx context.Context, key, id string, size int64) error {
	parts, err := s.parts(ctx, key, id)
	if err != nil {
		return err
	}
	if err = validateParts(parts, size); err != nil {
		return err
	}
	completed := make([]types.CompletedPart, 0, len(parts))
	for _, p := range parts {
		completed = append(completed, types.CompletedPart{PartNumber: aws.Int32(int32(p.PartNumber)), ETag: aws.String(p.ETag)})
	}
	_, err = s.client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{Bucket: s.bucket, Key: &key, UploadId: &id, MultipartUpload: &types.CompletedMultipartUpload{Parts: completed}})
	if err != nil {
		return r2Error(err)
	}
	exists, err := s.hasCompletedObject(ctx, key, size)
	if err != nil {
		return err
	}
	if !exists {
		return clientError(400, "上传完成后的文件大小不匹配")
	}
	return nil
}

func (s *r2Storage) hasCompletedObject(ctx context.Context, key string, size int64) (bool, error) {
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: s.bucket, Key: &key})
	var response *smithyhttp.ResponseError
	if errors.As(err, &response) && response.HTTPStatusCode() == 404 {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return out.ContentLength != nil && *out.ContentLength == size, nil
}

func (s *r2Storage) abort(ctx context.Context, key, id string) error {
	_, err := s.client.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{Bucket: s.bucket, Key: &key, UploadId: &id})
	return r2Error(err)
}
func (s *r2Storage) remove(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: s.bucket, Key: &key})
	return err
}
func (s *r2Storage) download(ctx context.Context, key string) (string, error) {
	req, err := s.presign.PresignGetObject(ctx, &s3.GetObjectInput{Bucket: s.bucket, Key: &key}, s3.WithPresignExpires(2*time.Minute))
	if err != nil {
		return "", err
	}
	return req.URL, nil
}
