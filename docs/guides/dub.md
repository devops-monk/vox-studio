# Dub a video

Turn a video in one language into a dubbed video in another, entirely on your computer.

## Before you start
Dubbing needs:
- **A Whisper model** to understand the original speech. The Dub page offers to download one.
- **A voice for the target language.** Kokoro covers English, Spanish, French, Italian, Portuguese, Hindi, Japanese and Chinese; macOS system voices cover many more (including German); your cloned voices (Chatterbox) speak English.

Translation packs download automatically the first time you dub between two languages.

## 1. Start a dub
1. Open **Dub** and click **New dub**.
2. Drop a video or audio file, up to 2 GB.
3. Choose **Dub into**. If no voice speaks that language yet, you'll see a note.
4. Click **Start dubbing**.

VoxStudio transcribes the speech, translates it, and suggests a voice. A progress bar shows each step. You can cancel at any time.

## 2. Review the lines
The **Lines** list shows each line's time, the original words (grey) and the translation (black).
- **Edit a translation** by clicking into it. Shorter translations fit their timing better.
- **▶** plays a line in its voice, so you can check it before rendering.
- **Click a time** to jump the video there.
- **S1 / S2 / S3 / S4**: assign lines to different speakers for a conversation. Each speaker gets their own voice.

## 3. Cast the voices
In **Cast**, choose an engine and a voice for each speaker. Only voices that speak the target language are listed.

Choose the mix:
- **Keep original quietly** (default): the original sound stays underneath, softly, so music and ambience remain.
- **Replace**: only the new voices.

## 4. Render
Click **Render dub**. When it's done:
- Switch the player between **Original** and **Dubbed** to compare.
- Each line shows how it fit: **fits**, **1.19× faster** (sped up to fit), or **+0.4 s long** (shorten that translation and render again).

## 5. Export
- **Video**: an MP4 with the new soundtrack (the picture is untouched).
- **Audio**: the dubbed soundtrack as WAV.
- **SRT / VTT**: subtitles in the dubbed language.

## Change language
Pick a different language in the menu at the top right. Every line is translated again, and the cast switches to a voice for that language. Then render again.

## Start from a link
Instead of a file, paste a **direct link to a video or audio file** under the drop area and click **Start dubbing**. VoxStudio downloads it (up to 2 GB), then prepares the dub as usual. Progress shows in the button and in Activity.

Only links that point straight at a media file work, for example `…/clip.mp4`. Links to web pages such as a video site's watch page are refused. Links to your own computer or local network are refused too.
