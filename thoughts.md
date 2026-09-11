## Personal Thoughts, In No Particular Order

- My personal desire is to see end developers empowered to make layouts that make UI more expressive, without sacrificing maintainability and performance or waiting for permission from the web committee. The current UI stereotypes across platforms tend to be one of:
  - a landing page with a few floating text chunks, powered by GL
  - a blog article with mostly text and little possible interactivity
  - a SaaS dashboard
  - a mobile UI made of two or three rectangles

- If you dig deep enough, 80% of the CSS spec could be avoided if user code had better control over text. Web layout shoves text into a single-direction black hole: putting text in is easy, but getting useful measurements back out requires DOM reads that are difficult to maintain and can be hugely expensive at runtime.

- The convenience case for CSS is gradually getting weaker:
  - adding expressivity tends to make CSS slower, despite the wishes of both standards authors and developers
  - few people want to program in CSS rather than declare styles
  - AI reduces the value of hard-coded CSS configuration that is more dictionary-like than compositional

- New browser implementations are hard because the specifications are enormous. Browser engines pursue architectural and performance improvements, then have to preserve decades of required behavior. UI performance and developer ergonomics _cannot_ improve by an order of magnitude while those requirements remain the bottleneck. Moving more capabilities into user code could at least stop the required browser behavior from growing; every browser vendor can agree on that, sometimes for completely opposing reasons.

- The cost of verifiable software will trend toward zero.
