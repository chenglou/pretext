import sourcesData from '../../../corpora/sources.json' with { type: 'json' }
import arAlBukhala from '../../../corpora/ar-al-bukhala.txt' with { type: 'text' }
import arRisalatAlGhufranPart1 from '../../../corpora/ar-risalat-al-ghufran-part-1.txt' with { type: 'text' }
import enGatsbyOpening from '../../../corpora/en-gatsby-opening.txt' with { type: 'text' }
import heMasaotBinyaminMetudela from '../../../corpora/he-masaot-binyamin-metudela.txt' with { type: 'text' }
import hiEidgah from '../../../corpora/hi-eidgah.txt' with { type: 'text' }
import jaKumoNoIto from '../../../corpora/ja-kumo-no-ito.txt' with { type: 'text' }
import jaRashomon from '../../../corpora/ja-rashomon.txt' with { type: 'text' }
import kmPrachumReuangPrengKhmerVolume7Stories1To10 from '../../../corpora/km-prachum-reuang-preng-khmer-volume-7-stories-1-10.txt' with { type: 'text' }
import myBadDeedsReturnToYouTeacher from '../../../corpora/my-bad-deeds-return-to-you-teacher.txt' with { type: 'text' }
import myCunningHeronTeacher from '../../../corpora/my-cunning-heron-teacher.txt' with { type: 'text' }
import koSonagi from '../../../corpora/ko-sonagi.txt' with { type: 'text' }
import koUnsuJohEunNal from '../../../corpora/ko-unsu-joh-eun-nal.txt' with { type: 'text' }
import mixedAppText from '../../../corpora/mixed-app-text.txt' with { type: 'text' }
import thNithanVetalStory1 from '../../../corpora/th-nithan-vetal-story-1.txt' with { type: 'text' }
import thNithanVetalStory7 from '../../../corpora/th-nithan-vetal-story-7.txt' with { type: 'text' }
import urChughd from '../../../corpora/ur-chughd.txt' with { type: 'text' }
import zhGuxiang from '../../../corpora/zh-guxiang.txt' with { type: 'text' }
import zhZhufu from '../../../corpora/zh-zhufu.txt' with { type: 'text' }

export const corpusSources = sourcesData

export const corpusTexts: Record<string, string> = {
  'ar-al-bukhala': arAlBukhala,
  'ar-risalat-al-ghufran-part-1': arRisalatAlGhufranPart1,
  'en-gatsby-opening': enGatsbyOpening,
  'he-masaot-binyamin-metudela': heMasaotBinyaminMetudela,
  'hi-eidgah': hiEidgah,
  'ja-kumo-no-ito': jaKumoNoIto,
  'ja-rashomon': jaRashomon,
  'km-prachum-reuang-preng-khmer-volume-7-stories-1-10': kmPrachumReuangPrengKhmerVolume7Stories1To10,
  'my-bad-deeds-return-to-you-teacher': myBadDeedsReturnToYouTeacher,
  'my-cunning-heron-teacher': myCunningHeronTeacher,
  'ko-sonagi': koSonagi,
  'ko-unsu-joh-eun-nal': koUnsuJohEunNal,
  'mixed-app-text': mixedAppText,
  'th-nithan-vetal-story-1': thNithanVetalStory1,
  'th-nithan-vetal-story-7': thNithanVetalStory7,
  'ur-chughd': urChughd,
  'zh-guxiang': zhGuxiang,
  'zh-zhufu': zhZhufu,
}
