Web fonts the harness serves to cases that list them in `fontFixtures`, with their licenses. The page loads them with
`FontFace` before anything measures, as an app that serves web fonts does.

- Amiri, Noto Naskh Arabic, Noto Nastaliq Urdu, Shantell Sans and ProbeShantell are taken unchanged from
  main's old wrapping suite (`tests/wrapping/fonts`, since removed). `ProbeShantell` names the bold Shantell file.
- Inter and Roboto are the two most requested Latin web fonts (Roboto on 10-10.7% of pages, Inter on 1.4-1.5%, HTTP
  Archive Almanac 2025, Fonts). The real-usage sample draws them for Latin text. Inter is under the SIL Open Font
  License 1.1, Roboto 2.137 under the Apache License 2.0, as their name tables say.

Installed fonts (Arial, Helvetica Neue, PingFang, Hiragino and so on) stay installed named faces: loading copies of system
font files as web fonts changed Safari's results in an earlier investigation.
