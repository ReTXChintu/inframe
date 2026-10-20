declare module "ffmpeg-static" {
  /** Absolute path of the bundled ffmpeg binary (null on unsupported platforms). */
  const ffmpegPath: string | null;
  export default ffmpegPath;
}
