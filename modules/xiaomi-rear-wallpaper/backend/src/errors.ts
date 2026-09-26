export class WallpaperError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "WallpaperError";
  }
}
