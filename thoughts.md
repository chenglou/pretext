## Personal Thoughts, In No Particular Order

- My personal desire is to see end-developers being empowered to make all the layouts that makes UI more expressive, without sacrificing maintainability & performance, and without having to wait for permissions from the web committee. The current UI stereotypes across all platforms has been either:
  - a landing-page with few, floating text chunks, powered by GL
  - a blog article with mostly just text and no possible interactivity
  - a SaaS dashboard
  - a mobile UI with 2-3 rectangles' worth of UI

- If you dig deep enough, 80% of CSS spec could be avoided if userland had better control over text. The paradigm of web layout shoves our text into a single-direction black hole, and to crawl those text metrics back incurs huge maintenance and performance overhead (ask AI about this).

- The convenience angle of CSS is gradually being eroded by the fact that:
  - the more CSS expressivity we bake in, the worse the CSS perf becomes (against all wishes from everyone on the committee and userland), and "programming" in CSS (as opposed to just "declare things" in CSS) is something very few desire
  - AI alleviates the need of having more hard-coded CSS configs, which are becoming more dictionary-like rather compositional.

- It's very hard to have new competing web browser implementations, because the specs are gigantic, and many engines (grassroot efforts, gamers-driven rewrites, languages-driven rewrites, etc.) eagerly chase & premature perf improvements before realizing that the specs, often written decades ago and disregarding modern perf & feature needs,  throw a wrench in those architectures. As a first approximation, UI performance & developer ergonomics _cannot_ possibly have an order of magnitude improvement, because the bottleneck is in the specs themselves. The only way to circumvent this is to bring more capabilities to userland, in a hope to stop the spec from over-growing even more in the future. Stopping spec complexity is something every browser vendor can agree on (and ironically, sometime for completely opposing reasons).

- The cost of any verifiable software will trend toward 0
