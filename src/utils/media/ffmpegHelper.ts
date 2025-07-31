import ffmpeg from 'fluent-ffmpeg';

interface FFmpegCommandOptions {
  inputPath: string;
  outputPath: string;
  resolution?: string | number; // Now supports both "1280x720" and height numbers like 720
  startTime?: string;
  duration?: string;
}

class FFmpegHelper {
  constructor() {
    // You may need to set the path to ffmpeg and ffprobe binaries
    // if they are not in your system's PATH.
    // For example, if you use ffmpeg-static:
    // ffmpeg.setFfmpegPath(require('ffmpeg-static'));
    // ffmpeg.setFfprobePath(require('ffprobe-static'));
  }

  /**
   * Converts height-based resolution to scale filter string that preserves aspect ratio
   * @param resolution - Height number (e.g., 480, 720, 1080) or full resolution string
   * @returns Scale filter string (e.g., "scale=-2:720") or full resolution string
   */
  private getAdaptiveResolution(
    resolution?: string | number,
  ): string | undefined {
    if (!resolution) return undefined;

    // If it's already a full resolution string, return as is
    if (typeof resolution === 'string' && resolution.includes('x')) {
      return resolution;
    }

    // Convert to number if it's a string
    let height =
      typeof resolution === 'string' ? parseInt(resolution) : resolution;

    // Ensure height is even (required by most video encoders)
    if (height % 2 !== 0) {
      height = height + 1; // Round up to next even number
      console.log(`Adjusted height to even number: ${height}`);
    }

    // Return scale filter that preserves aspect ratio with even dimensions
    // -2 means auto-calculate width to maintain original aspect ratio, rounded to nearest even number
    return `scale=-2:${height}`;
  }

  /**
   * Converts a video to HLS (HTTP Live Streaming) format.
   * @param options - Options for the FFmpeg command.
   * @returns A promise that resolves when the conversion is complete, or rejects on error.
   */
  public convertToHLS(options: FFmpegCommandOptions): Promise<void> {
    const { inputPath, outputPath, resolution } = options;
    const adaptiveResolution = this.getAdaptiveResolution(resolution);

    return new Promise((resolve, reject) => {
      const ffmpegCommand = ffmpeg(inputPath);

      const outputOptions = [
        '-c:v',
        'libx264',
        '-preset',
        'fast', // Add preset for faster encoding
        '-crf',
        '23', // Add quality setting
        '-hls_time',
        '10', // Change to 10 seconds per segment (was 60)
        '-hls_playlist_type',
        'vod', // Video on Demand
        '-hls_segment_filename',
        `${outputPath}%03d.ts`,
        '-f',
        'hls',
      ];

      // Add resolution scaling if specified
      if (adaptiveResolution && !adaptiveResolution.includes('x')) {
        // For scale filters like "scale=-1:240"
        outputOptions.push('-vf', adaptiveResolution);
        console.log(`Using video filter: ${adaptiveResolution}`);
      } else if (adaptiveResolution && adaptiveResolution.includes('x')) {
        // For exact resolutions like "1920x1080"
        const [width, height] = adaptiveResolution.split('x');
        outputOptions.push('-s', `${width}x${height}`);
        console.log(`Using exact resolution: ${width}x${height}`);
      }

      console.log('FFmpeg output options:', outputOptions);

      ffmpegCommand
        .outputOptions(outputOptions)
        .on('start', (commandLine) => {
          console.log('Spawned FFmpeg with command: ' + commandLine);
        })
        .on('stderr', (stderrLine) => {
          console.log('FFmpeg stderr: ' + stderrLine);
        })
        .on('end', () => {
          console.log('HLS conversion finished!');
          resolve();
        })
        .on('error', (err) => {
          console.error('Error during HLS conversion:', err);
          reject(err);
        })
        .save(outputPath + '.m3u8'); // M3U8 playlist file
    });
  }

  /**
   * Converts a video to DASH (Dynamic Adaptive Streaming over HTTP) format with AV1 encoding.
   * @param options - Options for the FFmpeg command.
   * @returns A promise that resolves when the conversion is complete, or rejects on error.
   */
  public convertToDASH(options: FFmpegCommandOptions): Promise<void> {
    const { inputPath, outputPath, resolution } = options;
    const adaptiveResolution = this.getAdaptiveResolution(resolution);

    return new Promise((resolve, reject) => {
      const ffmpegCommand = ffmpeg(inputPath);

      const outputOptions = [
        '-c:v',
        'libaom-av1', // AV1 video encoder
        '-crf',
        '30', // Quality level (lower = better quality, 15-50 range)
        '-cpu-used',
        '8', // Speed preset (0-8, higher = faster encoding)
        '-row-mt',
        '1', // Enable row-based multithreading
        '-c:a',
        'aac', // Audio encoder
        '-b:a',
        '128k', // Audio bitrate
        '-f',
        'dash', // DASH format
        '-seg_duration',
        '10', // 10 seconds per segment
      ];

      // Add resolution scaling if specified
      if (adaptiveResolution && !adaptiveResolution.includes('x')) {
        // For scale filters like "scale=-1:360"
        outputOptions.push('-vf', adaptiveResolution);
        console.log(`Using video filter: ${adaptiveResolution}`);
      } else if (adaptiveResolution && adaptiveResolution.includes('x')) {
        // For exact resolutions like "1920x1080"
        const [width, height] = adaptiveResolution.split('x');
        outputOptions.push('-s', `${width}x${height}`);
        console.log(`Using exact resolution: ${width}x${height}`);
      }

      console.log('Simplified AV1 DASH FFmpeg output options:', outputOptions);

      ffmpegCommand
        .outputOptions(outputOptions)
        .on('start', (commandLine) => {
          console.log(
            'Spawned simplified AV1 DASH FFmpeg with command: ' + commandLine,
          );
        })
        .on('stderr', (stderrLine) => {
          console.log('AV1 DASH FFmpeg stderr: ' + stderrLine);
        })
        .on('progress', (progress) => {
          console.log('AV1 encoding progress: ' + progress.percent + '% done');
        })
        .on('end', () => {
          console.log('DASH conversion with AV1 encoding finished!');
          resolve();
        })
        .on('error', (err) => {
          console.error('Error during AV1 DASH conversion:', err);
          reject(err);
        })
        .save(outputPath + '.mpd'); // MPD manifest file
    });
  }

  /**
   * Converts a video to DASH format with SVT-AV1 encoder (faster alternative).
   * @param options - Options for the FFmpeg command.
   * @returns A promise that resolves when the conversion is complete, or rejects on error.
   */
  public convertToDASHSVT(options: FFmpegCommandOptions): Promise<void> {
    const { inputPath, outputPath, resolution } = options;
    const adaptiveResolution = this.getAdaptiveResolution(resolution);

    return new Promise((resolve, reject) => {
      const ffmpegCommand = ffmpeg(inputPath);

      const outputOptions = [
        '-c:v',
        'libsvtav1', // SVT-AV1 video encoder (faster than libaom)
        '-crf',
        '30', // Quality level
        '-preset',
        '8', // Speed preset (0-13, higher = faster)
        '-c:a',
        'aac', // Audio encoder
        '-b:a',
        '128k', // Audio bitrate
        '-f',
        'dash', // DASH format
        '-seg_duration',
        '10', // 10 seconds per segment
      ];

      // Add resolution scaling if specified
      if (adaptiveResolution && !adaptiveResolution.includes('x')) {
        outputOptions.push('-vf', adaptiveResolution);
        console.log(`Using video filter: ${adaptiveResolution}`);
      } else if (adaptiveResolution && adaptiveResolution.includes('x')) {
        const [width, height] = adaptiveResolution.split('x');
        outputOptions.push('-s', `${width}x${height}`);
        console.log(`Using exact resolution: ${width}x${height}`);
      }

      console.log('SVT-AV1 DASH FFmpeg output options:', outputOptions);

      ffmpegCommand
        .outputOptions(outputOptions)
        .on('start', (commandLine) => {
          console.log(
            'Spawned SVT-AV1 DASH FFmpeg with command: ' + commandLine,
          );
        })
        .on('stderr', (stderrLine) => {
          console.log('SVT-AV1 DASH FFmpeg stderr: ' + stderrLine);
        })
        .on('progress', (progress) => {
          console.log(
            'SVT-AV1 encoding progress: ' + progress.percent + '% done',
          );
        })
        .on('end', () => {
          console.log('DASH conversion with SVT-AV1 encoding finished!');
          resolve();
        })
        .on('error', (err) => {
          console.error('Error during SVT-AV1 DASH conversion:', err);
          reject(err);
        })
        .save(outputPath + '.mpd');
    });
  }

  /**
   * Generates a thumbnail from a video at a specific time.
   * @param options - Options for the FFmpeg command.
   * @returns A promise that resolves when the thumbnail is generated, or rejects on error.
   */
  public generateThumbnail(options: FFmpegCommandOptions): Promise<void> {
    const { inputPath, outputPath, startTime, resolution } = options;

    return new Promise((resolve, reject) => {
      const ffmpegCommand = ffmpeg(inputPath);

      console.log(`Generating thumbnail: ${inputPath} -> ${outputPath}`);
      console.log(
        `Start time: ${startTime || '00:00:01'}, Resolution: ${resolution}`,
      );

      // Use a simple, robust approach
      ffmpegCommand
        .seekInput(startTime || '00:00:01')
        .frames(1)
        .outputOptions(['-y']) // Overwrite output file
        .on('start', (commandLine) => {
          console.log('Thumbnail FFmpeg command: ' + commandLine);
        })
        .on('stderr', (stderrLine) => {
          console.log('Thumbnail FFmpeg stderr: ' + stderrLine);
        })
        .on('end', () => {
          console.log('Thumbnail generation finished!');
          resolve();
        })
        .on('error', (err) => {
          console.error('Error during thumbnail generation:', err);
          reject(err);
        });

      // Add resolution scaling if specified
      if (resolution) {
        if (typeof resolution === 'string' && resolution.includes('x')) {
          // Exact resolution like "320x240"
          const [width, height] = resolution.split('x');
          ffmpegCommand.size(`${width}x${height}`);
          console.log(`Using exact size for thumbnail: ${width}x${height}`);
        } else {
          // Height-only, use scale filter
          let height =
            typeof resolution === 'string' ? parseInt(resolution) : resolution;
          if (height % 2 !== 0) height = height + 1; // Ensure even
          ffmpegCommand.videoFilter(`scale=-2:${height}`);
          console.log(`Using scale filter for thumbnail: scale=-2:${height}`);
        }
      }

      ffmpegCommand.save(outputPath);
    });
  }

  /**
   * Gets video metadata.
   * @param inputPath - Path to the video file.
   * @returns A promise that resolves with video metadata, or rejects on error.
   */
  public getMetadata(inputPath: string): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(err);
        } else {
          resolve(metadata);
        }
      });
    });
  }
}

export { FFmpegHelper, FFmpegCommandOptions };
