# Tools

Open **Tools** from the sidebar. There are three tools: **Clean up**, **Change voice** and **Pronunciation**.

## Clean up a recording
Rescue a noisy voice memo, a Zoom recording or a clip you recorded in a hurry.

1. Drop an audio or video file onto the card, or choose one of your **recent takes**.
2. Choose what to fix:
   - **Reduce noise**: removes steady hiss, hum, fan noise and low rumble.
   - **Tighten pauses**: shortens silences longer than 0.6 s and cuts dead air at the start and end.
   - **Even out loudness**: brings the clip to a standard level so it sits well next to other clips.
     - **Podcast**: −16 LUFS
     - **Streaming**: −14 LUFS
     - **Broadcast**: −23 LUFS
     - Peaks are always kept under −1.5 dB.
3. Click **Clean up**.

Compare **Before** and **After** by playing them side by side. The meters show how the average level and peak changed, and how much dead air was removed. The cleaned clip is saved to **History**, and your original is never changed.

> Clean up uses the Whisper runtime to read media, so download any Whisper model from **Models** first.

## Change the voice of a recording
Keep exactly what was said, and how it was said (the words, timing, pauses and emphasis), but in a different voice. This is useful for:
- re-voicing a scratch narration in your cloned voice
- making a consistent voice across clips recorded on different days
- anonymising a speaker

1. Drop a recording (up to 15 minutes) or choose a recent take.
2. Under **Speak it as**, pick **Chatterbox Default** or one of **your voices**. To add one, click **Clone a voice**.
3. Click **Change voice**. Long recordings are processed in sections split at natural pauses, so no word is cut in half.

This needs the **Chatterbox** engine. Only convert recordings you have the right to use. Like everything Chatterbox makes, the result carries an inaudible watermark that marks it as AI-generated.

## Teach voices how to say words
Voices sometimes mispronounce names, acronyms and brand words. Add a word once, and every voice says it the way you want everywhere:
- Studio
- long renders
- batches and watch folders
- dubs
- stories and audiobooks

1. Under **Written as**, type the word as it appears in your text, for example `Nguyen`.
2. Under **Say it like**, spell it the way it sounds, for example `Win`.
3. Click **Add**, or press Return.

Tips:
- Matches are whole words, and capitalization is ignored. Click **Aa** on a word to match its exact capitalization only. This is useful for `IT` (the department) versus `it`.
- Phrases work too: `New York → Noo Yawk`. Longer entries win over shorter ones.
- Acronyms read letter by letter work best with spaces: `AWS → A W S`.
- Click a word or its pronunciation to edit it. The **Try it** box shows exactly what the voices will read.

Your scripts, takes and transcripts keep what you wrote. Only the audio changes.
