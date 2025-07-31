/* eslint-disable @typescript-eslint/no-unused-vars */
import { Downloader_options, Audio_format, Status, Download_item, Track } from "../types/index.js";
// import { spawn } from "node:child_process"
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import download_ffmpeg from './env/install_ffmpeg.js'
import download_ytdlp from './env/yt-dlp_download.js'
import download_spotdlp from './env/spot-dlp_download.js'
import Music from "./music/index.js";
import ytdl from "@distube/ytdl-core";
import axios from "axios";
import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs';
import path from 'node:path';
import readline from "node:readline"

export default class Downloader {
    public folder: string = ""
    public audio_format: string = Audio_format.mp3;
    public checking_queue: Download_item[] = [];
    public download_queue: Download_item[] = [];
    public curr_folder: string | undefined = "";
    public stastus: Status = Status.idle;
    public port: number = 3000;
    public music: Music;

    constructor(options: Downloader_options) {
        // folder
        this.folder = options.download_folder || "";
        this.curr_folder = options.curr_folder || "";

        // options
        this.audio_format = options.audio_format || Audio_format.m4a;

        // client API
        this.music = new Music({
            youtube_api_key: options.youtube_api_key,
            spotify_api_key: options.spotify_api_key,
            spotify_client: options.spotify_client,
            google_client_id: options.google_client_id,
            google_client_secret: options.google_client_secret,
            redirect_uris: options.redirect_uris,
            port: options.port || 3000,
        })

        // status
        this.stastus = Status.idle;
    }


    async get_status(): Promise<any> {
        return {
            status: this.stastus,

        };
    }

    getdownload() {
        this.stastus = Status.idle;
        return `${this.folder}\\download.7z`
    }

    set_status(status: Status) {
        this.stastus = status;
    }

    set_download_foler(str: string) {
        this.folder = str;
    }

    set_audio_format(format: Audio_format) {
        this.audio_format = format;
    }

    clear_links() {
        this.checking_queue = [];
        this.download_queue = [];
    }

    get_download_folder() {
        return this.folder
    }

    get_audio_format() {
        return this.audio_format
    }


    get_queue() {
        return this.download_queue;
    }

    format_title(title: string): string {
        const emojiAndSymbolPattern =
            /[\u2600-\u27FF\u2B00-\u2BFF\u2300-\u23FF\u{1F000}-\u{1FFFF}\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F900}-\u{1F9FF}]/gu;
        const regionalIndicatorPattern = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;
        const invalidCharsPattern = /[|/?*:<>"]/g;
        const multipleSpacesPattern = /\s+/g;
        const trimSpacesPattern = /(^\s+|\s+$)/g;
        let cleanedTitle = title;

        cleanedTitle = cleanedTitle.replace(regionalIndicatorPattern, "");
        cleanedTitle = cleanedTitle.replace(emojiAndSymbolPattern, "");
        cleanedTitle = cleanedTitle.replace(invalidCharsPattern, "");
        cleanedTitle = cleanedTitle.replace(multipleSpacesPattern, " ");
        cleanedTitle = cleanedTitle.replace(trimSpacesPattern, "");

        return cleanedTitle;
    }
    async checking(): Promise<void> {
        // get all filename in a folder
        const files = readdirSync(this.folder);
        for (const file of files) {
            const checked = this.checking_queue.find(item => item.title === file.split(`.${this.audio_format}`)[0])
            if (!checked) {
                // delete that file in download folder
                try {
                    unlinkSync(`${this.folder}\\${file}`); // Delete the file
                    console.log(`Deleted: ${file}`);
                } catch (error) {
                    console.error(`Error deleting ${file}:`, error);
                }
            }
        }
    }

    sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    renderProgressBar = (process_item: string, percent: number) => {
        const barLength = 40;
        const filledLength = Math.round((percent / 100) * barLength);
        const bar = '█'.repeat(filledLength) + '-'.repeat(barLength - filledLength);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`Downloading ${process_item}: [${bar}] ${percent.toFixed(1)}%`);
    };

    donwloading(title: string, id: string, metadata: { artist: string, year: string, thumbnail: string }): Promise<any> {
        return new Promise(async (resolve, reject) => {
            const __dirname = this.folder,
                outputFileName = `${title}.${this.audio_format}`,
                outputPath = path.resolve(__dirname, outputFileName);

            let tempThumbnailPath: string | null = null;
            const url = `https://www.youtube.com/watch?v=${id}&rco=1`

            try {
                console.log(`Fetching info for URL: ${url}`);
                const info = await ytdl.getInfo(url);

                const videoTitle = this.format_title(info.videoDetails.title); // Sanitize for filename

                console.log(`Downloading audio stream for: "${info.videoDetails.title}"`);

                // Find the best audio-only format
                const audioFormat = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });

                if (!audioFormat) {
                    throw new Error('No suitable audio format found.');
                }

                console.log(`Selected audio format: ${audioFormat.mimeType}, quality: ${audioFormat.qualityLabel || audioFormat.audioBitrate}`);

                const audioStream = ytdl(url, { format: audioFormat });

                // Create an FFmpeg command
                const command = ffmpeg(audioStream);

                // Set output format
                if (this.audio_format === Audio_format.mp3) {
                    command.audioCodec('libmp3lame').audioBitrate(192); // Example bitrate
                } else if (this.audio_format === Audio_format.m4a) {
                    command.audioCodec('aac').audioBitrate(192); // Example bitrate
                }

                // Embed metadata
                if (title) {
                    command.outputOptions('-metadata', `title=${title}`);
                }
                if (metadata.artist) {
                    command.outputOptions('-metadata', `artist=${metadata.artist}`);
                }
                if (metadata.year) {
                    command.outputOptions('-metadata', `year=${metadata.year}`);
                }

                if (metadata.thumbnail) {
                    console.log(`Downloading thumbnail from: ${metadata.thumbnail}`);
                    const response = await axios.get(metadata.thumbnail, { responseType: 'arraybuffer' });
                    const thumbnailBuffer = Buffer.from(response.data);

                    // Determine image format (e.g., .jpg, .png) from content type or guess
                    const contentType = response.headers['content-type'] || 'image/jpeg'; // Default to jpeg
                    let ext = '.jpg';
                    if (contentType.includes('png')) {
                        ext = '.png';
                    } else if (contentType.includes('gif')) {
                        ext = '.gif';
                    }

                    tempThumbnailPath = path.resolve(__dirname, `temp_thumbnail_${Date.now()}${ext}`);
                    await fs.promises.writeFile(tempThumbnailPath, thumbnailBuffer);
                    console.log(`Thumbnail downloaded to: ${tempThumbnailPath}`);
                }

                command.audioCodec((this.audio_format === Audio_format.mp3 ? "libmp3lame" : "aac")).audioBitrate(192);
                if (tempThumbnailPath) {
                    command.addInput(tempThumbnailPath);
                    command.outputOptions([
                        '-map', '0:a',
                        '-map', '1:v',
                        '-c:v', 'copy',
                        '-disposition:v:0', 'attached_pic'
                    ]);
                } else {
                    command.outputOptions([
                        '-map', '0:a'
                    ]);
                }

                command
                    .on('start', (commandLine) => {
                        console.log('FFmpeg command started:', commandLine);
                    })
                    .on('progress', (progress) => {
                        // this.renderProgressBar(`${title}`, progress.percent as number)
                        console.log(`Processing: ${progress.timemark}`);
                    })
                    .on('end', async () => {
                        console.log(`\nDownload and metadata embedding finished for "${videoTitle}". Saved to: ${outputPath}`);
                        if (tempThumbnailPath && fs.existsSync(tempThumbnailPath)) {
                            await fs.promises.unlink(tempThumbnailPath).catch(cleanUpErr => console.error('Error during emergency cleanup:', cleanUpErr));
                        }
                        resolve("ok")
                    })
                    .on('error', (err, stdout, stderr) => {
                        console.error(`FFmpeg error: ${err.message}`);
                        console.error('FFmpeg stdout:', stdout);
                        console.error('FFmpeg stderr:', stderr);
                        resolve("not oke")
                    })
                    .save(outputPath);
            } catch (error) {
                console.error('An error occurred:', error);
                if (tempThumbnailPath && fs.existsSync(tempThumbnailPath)) {
                    await fs.promises.unlink(tempThumbnailPath).catch(cleanUpErr => console.error('Error during emergency cleanup:', cleanUpErr));
                }
                resolve("not ok")
            }
        })
    }

    async download() {
        while (this.stastus === Status.env) {
            await this.sleep(200);
        }

        await mkdir(`${this.folder}`, { recursive: true })
        this.set_status(Status.downloading)

        while (this.download_queue.length > 0) {
            const downloader = this.download_queue.shift() as Download_item;
            const { title, id, metadata } = downloader
            const temp = `${this.folder}\\${title}.${this.audio_format}`
            console.log(`${temp} is ${!existsSync(temp) === true ? "not" : ""} existed`)

            try {
                if (!existsSync(`${this.folder}\\${title}.${this.audio_format}`)) {
                    await this.donwloading(title, id, metadata)
                }
            }
            catch (e) {
                console.error(e)
                const track: Track = await this.music.youtube.fetchVideos(id);
                const data = await this.music.youtube.findMatchingVideo(track);
                if (data) {
                    this.download_queue.push({
                        title: this.format_title(data.track.name),
                        id: data.track.id,
                        metadata: {
                            artist: data.artists[0].name,
                            year: data.track.releaseDate,
                            thumbnail: data.thumbnail
                        }
                    })
                }
            }
        }
    }

    async check_env(): Promise<void> {
        this.set_status(Status.env);
        const ffmpeg_path = `${this.curr_folder}\\support\\ffmpeg\\ffmpeg.exe`;
        const ffplay_path = `${this.curr_folder}\\support\\ffmpeg\\ffplay.exe`;
        const ffprobe_path = `${this.curr_folder}\\support\\ffmpeg\\ffprobe.exe`;
        const ytdlp_path = `${this.curr_folder}\\support\\yt-dlp.exe`;
        const spotdlp_path = `${this.curr_folder}\\support\\spot-dlp.exe`;

        await mkdir(`${this.curr_folder}\\support`, { recursive: true })

        if (!existsSync(ffmpeg_path) || !existsSync(ffplay_path) || !existsSync(ffprobe_path)) {
            await mkdir(`${this.curr_folder}\\temping`, { recursive: true })
            console.warn("FFmpeg not found. Downloading...");
            await download_ffmpeg(this.curr_folder as string);
        }

        if (!existsSync(ytdlp_path)) {
            console.warn("yt-dlp not found. Downloading...");
            await download_ytdlp(this.curr_folder as string)
        }

        if (!existsSync(spotdlp_path)) {
            console.warn("spot-dlp not found. Downloading...");
            await download_spotdlp(this.curr_folder as string)
        }

        this.set_status(Status.idle);
    }

    async getAudioURLAlternative(id: string): Promise<string> {
        try {
            const videoUrl = `https://www.youtube.com/watch?v=${id}`;

            // console.log(this.youtube_access_token)

            const info = await ytdl.getInfo(videoUrl);

            const audioFormat = ytdl.chooseFormat(info.formats, {
                filter: 'audioonly',
                quality: 'highestaudio',
            });

            if (audioFormat && audioFormat.url) {
                // console.log('Audio URL:', audioFormat.url);
                return audioFormat.url; // You can return the URL to use in your React component
            } else {
                throw new Error('Could not find a valid audio URL.')
            }
        } catch (error: any) {
            throw new Error(error)
        }
    }
}
