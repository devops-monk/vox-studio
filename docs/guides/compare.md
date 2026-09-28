# Compare voices (blind test)

Voices sound different in a demo than in your own script, and knowing a voice's name can bias you. **Compare** runs a blind taste test, so you find the voice you actually prefer.

1. Open **Compare** and pick a **language**.
2. Write, or shuffle to, the sentence the voices will read. Use a line like the ones you'll really produce: names, numbers and emotion show differences quickly.
3. Pick **2–5 voices**, from any engine including your cloned voices, and click **Start blind test**.
4. Each round plays two anonymous recordings, **A** and **B**. Listen to both (**1** and **2**), then choose **A sounds better** (**←**), **About the same** (**T**) or **B sounds better** (**→**). Every pair comes up once, in random order and on random sides, with at most 10 rounds.
5. At the end, the names are revealed with a ranking. Click **Use as my quick voice** to make the winner the voice for Quick Speak and “Try a voice”.

The test recordings are removed afterwards, unless you switch on **Keep these recordings in History**.

## Your favourites
Every choice is remembered per language. **Your favourites** ranks all the voices you've compared, using an Elo score: it starts at 1000, rises when a voice beats a strong one, and falls when it loses to a weak one. It also shows wins–losses–ties. The more tests you run, the more reliable it gets.

From the API: [`POST /v1/ratings` and `GET /v1/ratings/leaderboard`](../api/reference/compare.md).
