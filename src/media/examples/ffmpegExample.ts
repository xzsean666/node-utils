import { FFmpegHelper } from '../ffmpegHelper';
import * as fs from 'fs';
import * as path from 'path';

const ffmpegHelper = new FFmpegHelper();

async function examples() {
  // Use an existing video file from the project
  const inputVideo = './src/utils/media/examples/example-video.mp4';

  // Create output directories if they don't exist
  const hlsOutputDir = './output/hls';
  const dashOutputDir = './output/dash';

  if (!fs.existsSync('./output')) {
    fs.mkdirSync('./output', { recursive: true });
  }
  if (!fs.existsSync(hlsOutputDir)) {
    fs.mkdirSync(hlsOutputDir, { recursive: true });
  }
  if (!fs.existsSync(dashOutputDir)) {
    fs.mkdirSync(dashOutputDir, { recursive: true });
  }

  console.log(`Using input video: ${inputVideo}`);
  console.log(`Video file exists: ${fs.existsSync(inputVideo)}`);
  console.log(`Input file size: ${fs.statSync(inputVideo).size} bytes`);

  try {
    // Example 0: Get video metadata first
    console.log('\n=== Getting video metadata ===');
    const metadata = await ffmpegHelper.getMetadata(inputVideo);
    console.log('Video duration:', metadata.format?.duration, 'seconds');
    console.log(
      'Original resolution:',
      metadata.streams?.[0]?.width,
      'x',
      metadata.streams?.[0]?.height,
    );
    console.log('Video codec:', metadata.streams?.[0]?.codec_name);
    console.log('Audio codec:', metadata.streams?.[1]?.codec_name);

    // Example 1: Generate thumbnail first (simplest test)
    console.log('\n=== Testing basic thumbnail generation (no resolution) ===');
    try {
      await ffmpegHelper.generateThumbnail({
        inputPath: inputVideo,
        outputPath: 'test-thumb-basic.jpg',
        startTime: '00:00:02', // Try a different time
      });
      console.log('✅ Basic thumbnail generated successfully');
    } catch (basicError) {
      console.log(
        `❌ Basic thumbnail failed: ${basicError instanceof Error ? basicError.message : 'Unknown error'}`,
      );
    }

    console.log('\n=== Testing thumbnail with resolution ===');
    try {
      await ffmpegHelper.generateThumbnail({
        inputPath: inputVideo,
        outputPath: 'test-thumb-240p.jpg',
        startTime: '00:00:02',
        resolution: 240, // Height only - width calculated to maintain original proportions
      });
      console.log('✅ Resolution thumbnail generated successfully');
    } catch (resError) {
      console.log(
        `❌ Resolution thumbnail failed: ${resError instanceof Error ? resError.message : 'Unknown error'}`,
      );
    }

    // Example 2: Test HLS conversion with detailed logging
    console.log('\n=== Converting to HLS with 240p height ===');
    await ffmpegHelper.convertToHLS({
      inputPath: inputVideo,
      outputPath: './output/hls/playlist',
      resolution: 240, // Height only - width auto-calculated to preserve original aspect ratio
    });
    console.log('✅ HLS conversion completed!');

    // Example 3: Test AV1 DASH conversion
    console.log('\n=== Converting to DASH with AV1 at 360p height ===');
    try {
      await ffmpegHelper.convertToDASH({
        inputPath: inputVideo,
        outputPath: './output/dash/av1_manifest',
        resolution: 360, // Height only - maintains original video proportions
      });
      console.log('✅ AV1 DASH conversion completed!');
    } catch (av1Error) {
      console.log(
        `❌ AV1 DASH failed: ${av1Error instanceof Error ? av1Error.message : 'Unknown error'}`,
      );

      // Fallback: Try SVT-AV1 if libaom-av1 fails
      console.log('🔄 Trying SVT-AV1 encoder as fallback...');
      try {
        await ffmpegHelper.convertToDASHSVT({
          inputPath: inputVideo,
          outputPath: './output/dash/svt_av1_manifest',
          resolution: 360,
        });
        console.log('✅ SVT-AV1 DASH conversion completed!');
      } catch (svtError) {
        console.log(
          `❌ SVT-AV1 also failed: ${svtError instanceof Error ? svtError.message : 'Unknown error'}`,
        );
        console.log(
          '💡 Both AV1 encoders failed. Your FFmpeg might not support AV1 encoding.',
        );
      }
    }

    console.log('\n🎉 All conversions completed successfully!');
  } catch (error) {
    console.error('\n❌ Error occurred:', error);
    console.error(
      'Error details:',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

// Uncomment to run all examples
examples();

export { examples };
