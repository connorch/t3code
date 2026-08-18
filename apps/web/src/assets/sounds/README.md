# Completion sounds

The chimes offered by Settings → General → Completion sound. Imported by
`apps/web/src/lib/threadCompletionChimes.ts`, so the bundler content-hashes them; adding a chime
means adding a file here, a literal in `ThreadCompletionChime` (`packages/contracts/src/settings.ts`),
and an entry in that module's option list.

Both files were supplied as royalty-free audio by "Dragon-Studio". Original filenames:

| File         | Original filename                     |
| ------------ | ------------------------------------- |
| `bubble.mp3` | `dragon-studio-bubble-pop-406640.mp3` |
| `pop.mp3`    | `dragon-studio-pop-402324.mp3`        |
