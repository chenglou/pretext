These unchanged font files are fixtures for the wrapping inventory, not runtime dependencies. `fonts.json` records the exact bytes, original experiment paths and accompanying SIL Open Font License notices. The browser verifies each SHA-256 before loading it.

Amiri 1.002, Noto Naskh Arabic 2.021, Noto Nastaliq Urdu 3.007, and Shantell Sans 1.011 come from the earlier controlled-font experiments. `ProbeShantell` deliberately names the bold Shantell file used by the later comparison audits. `Shantell Sans` exposes the original regular and bold faces. These names and weights are part of the tests; do not interchange the two Shantell files.

Arial, Times New Roman, Courier New, Georgia, and other installed fonts remain installed named faces. Loading copies of system font files as web fonts changed Safari results in an earlier investigation. The runner records the platform and browser instead of substituting those faces.

The license texts were retrieved from the corresponding `google/fonts` family directories; their source URLs are recorded next to each fixture.
