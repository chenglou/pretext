// Short chat-like texts in Latin, Arabic, Hebrew, CJK, Korean, Thai, emoji,
// mixed directions and edge cases (empty, whitespace, newlines, long words). The
// harness's rich set splits them into styled runs (harness/sets/rich.ts), and the
// bench's worst-case shapes are made from them.

export const TEXTS = [
  // Latin
  { label: 'Latin update', text: "Just tried the new update and it's so much better. The performance improvements are really noticeable, especially on older devices." },
  { label: 'Latin compatibility', text: "Does anyone know if this works with the latest version? I've been having some issues since the upgrade." },
  { label: 'Latin short', text: "This is exactly what I was looking for. Simple, clean, and does exactly what it says on the tin." },
  { label: 'Latin caching', text: "The key insight is that you can cache word measurements separately from layout results. This gives you the best of both worlds." },
  { label: 'Latin punctuation', text: "Performance is critical for this kind of library. If you can't measure hundreds of text blocks per frame, it's not useful for real applications." },
  { label: 'Latin hyphenation', text: "One thing I noticed is that the line breaking algorithm doesn't handle hyphenation. Is that on the roadmap?" },

  // Arabic
  { label: 'Arabic', text: "هذا النص باللغة العربية لاختبار دعم الاتجاه من اليمين إلى اليسار في مكتبة تخطيط النص" },
  { label: 'Arabic short', text: "مرحبا بالعالم، هذه تجربة لقياس النص العربي وكسر الأسطر بشكل صحيح" },

  // Hebrew
  { label: 'Hebrew', text: "זהו טקסט בעברית כדי לבדוק תמיכה בכיוון מימין לשמאל בספריית פריסת הטקסט" },
  { label: 'Hebrew short', text: "שלום עולם, זוהי בדיקה למדידת טקסט עברי ושבירת שורות" },

  // Mixed LTR + RTL
  { label: 'Mixed en+ar', text: "The meeting is scheduled for يوم الثلاثاء at the main office. Please bring your مستندات with you." },
  { label: 'Mixed report', text: "According to the report by محمد الأحمد, the results show significant improvement in performance." },
  { label: 'Mixed en+he', text: "The project name is פרויקט חדש and it was started last month by the research team." },
  { label: 'Mixed version', text: "Version 3.2.1 של התוכנה was released on January 15th with many improvements." },

  // CJK
  { label: 'Chinese', text: "这是一段中文文本，用于测试文本布局库对中日韩字符的支持。每个字符之间都可以断行。" },
  { label: 'Chinese short', text: "性能测试显示，新的文本测量方法比传统方法快了将近一千五百倍。" },
  { label: 'Japanese', text: "これはテキストレイアウトライブラリのテストです。日本語のテキストを正しく処理できるか確認します。" },
  { label: 'Japanese short', text: "パフォーマンスは非常に重要です。フレームごとに数百のテキストブロックを測定する必要があります。" },
  { label: 'Korean', text: "이것은 텍스트 레이아웃 라이브러리의 테스트입니다. 한국어 텍스트를 올바르게 처리할 수 있는지 확인합니다." },

  // Thai
  { label: 'Thai', text: "นี่คือข้อความทดสอบสำหรับไลบรารีจัดวางข้อความ ทดสอบการตัดคำภาษาไทย" },

  // Emoji
  { label: 'Emoji mixed', text: "The quick 🦊 jumped over the lazy 🐕 and then went home 🏠 to rest 😴 for the night." },
  { label: 'Emoji dense', text: "Great work! 👏👏👏 This is exactly what we needed 🎯 for the project 🚀" },

  // Mixed everything
  { label: 'Multi-script', text: "Hello مرحبا שלום 你好 こんにちは 안녕하세요 สวัสดี — a greeting in seven scripts!" },
  { label: 'Numbers+RTL', text: "The price is $42.99 (approximately ٤٢٫٩٩ ريال or ₪158.50) including tax." },

  // Edge cases
  { label: 'Empty', text: "" },
  { label: 'Single char', text: "A" },
  { label: 'Whitespace', text: "   " },
  { label: 'Newlines', text: "Hello\nWorld\nMultiple\nLines" },
  { label: 'Long word', text: "Superlongwordwithoutanyspacesthatshouldjustoverflowthelineandkeepgoing" },
  { label: 'Long mixed', text: "In the heart of القاهرة القديمة, you can find ancient mosques alongside modern cafés. The city's history spans millennia. كل شارع يحكي قصة مختلفة about the rich cultural heritage." },
] as const
