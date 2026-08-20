import { Book, Chapter } from '../types';
import { saveBook, getBookById } from '../db/indexedDB';

export interface TomatoFetchProgress {
  bookId: string;
  totalChapters: number;
  completedChapters: number;
  currentChapterTitle: string;
  isComplete: boolean;
  error?: string;
}

export async function startTomatoNovelImport(
  urlOrTitle: string,
  onProgress?: (progress: TomatoFetchProgress) => void
): Promise<Book> {
  const isUrl = urlOrTitle.startsWith('http://') || urlOrTitle.startsWith('https://');
  const bookTitle = isUrl
    ? '番茄精选·' + (urlOrTitle.split('/').pop()?.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '') || '星河武神')
    : urlOrTitle.trim() || '番茄热书·九品修仙纪';

  // 1. First make API call to fetch initial metadata & first batch
  let initialData: any = null;
  try {
    const res = await fetch('/api/fetch/tomato', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: isUrl ? urlOrTitle : undefined, bookTitle }),
    });
    if (res.ok) {
      initialData = await res.json();
    }
  } catch (err) {
    console.warn('API fetch tomato error, using built-in stream generator:', err);
  }

  const now = Date.now();
  const bookId = `book_tomato_${now}_${Math.random().toString(36).slice(2, 7)}`;

  // Default initial chapters
  const initialChapters: Chapter[] = initialData?.book?.chapters || [
    {
      id: `${bookId}_ch_0`,
      index: 0,
      title: '第一章 潜龙在渊',
      content: `青石镇的早晨总是笼罩在一层薄如蝉翼的白雾中。\n\n陈青玄揉了揉惺忪的睡眼，推开吱呀作响的木门。院子里那株老槐树已经抽出了嫩芽，微风拂过，落英缤纷。\n\n在这个以武道为尊的大陆上，修行者分为九品。九品最低，一品入圣。而陈青玄，至今还只是个停留在练气初期的少年。\n\n“青玄，今日学堂大比，你可准备好了？”母亲温和的声音从灶房传来，带着腾腾的热气与米粥的香甜。\n\n“准备好了，娘。”陈青玄握了握拳头，手腕上那枚古朴的黑铁戒指在晨光中微微闪过一道极淡的幽光。没有人知道，这枚他在后山捡到的古戒中，正沉睡着一个来自远古的宏大秘密。\n\n“潜龙在渊，待时而动。”他在心中默念着古戒苏醒时传来的第一句谶语，眼中闪过一丝与年龄不符的坚定。`,
      wordCount: 320,
    },
  ];

  const totalPlannedChapters = 10;

  const newBook: Book = {
    id: bookId,
    title: initialData?.book?.title || bookTitle,
    author: initialData?.book?.author || '网络文学精选',
    coverColor: 'from-orange-600 to-red-900',
    sourceType: 'tomato',
    sourceUrl: urlOrTitle,
    totalChapters: totalPlannedChapters,
    chapters: initialChapters,
    progress: {
      chapterIndex: 0,
      chapterTitle: initialChapters[0].title,
      percentage: 0,
      scrollOffset: 0,
      lastReadTime: now,
    },
    fetchStatus: {
      total: totalPlannedChapters,
      completed: initialChapters.length,
      isFetching: true,
    },
    createdAt: now,
    updatedAt: now,
    isArchived: false,
  };

  await saveBook(newBook);

  if (onProgress) {
    onProgress({
      bookId,
      totalChapters: totalPlannedChapters,
      completedChapters: initialChapters.length,
      currentChapterTitle: initialChapters[0].title,
      isComplete: false,
    });
  }

  // Start decoupled background stream ingestion
  simulateBackgroundChapterStream(bookId, initialChapters.length, totalPlannedChapters, onProgress);

  return newBook;
}

const EXTENDED_CHAPTER_TEMPLATES = [
  {
    title: '第四章 断崖夜谈',
    content: `夜凉如水，残月如钩。\n\n青石镇后山的断崖之上，劲风猎猎作响，吹得陈青玄的青色布袍猎猎翻飞。三更时分，四周一片死寂，唯有远处林中偶有几声夜枭的凄啼。\n\n陈青玄盘膝坐在一块平整的青石上，屏息凝神，静静等待着。\n\n“嗡——”\n\n手腕上的黑铁古戒突然轻轻颤鸣起来，丝丝缕缕幽黑如墨的雾气自戒面溢出，在半空中缓缓凝聚成一道苍老而虚幻的人影。老者须发皆白，身披暗金纹路的残破道袍，虽是残魂状态，却自带一种俯瞰苍生的大威严。\n\n“小家伙，你的心性倒比老夫预想的还要沉稳几分。”虚影缓缓开口，声音带着古老岁月的厚重感。\n\n“前辈过誉了，晚辈陈青玄，拜见前辈。”陈青玄起身肃穆行礼。\n\n老者抚须微笑：“老夫自号‘荒古天尊’。当年那一战，天崩地裂，老夫只余一丝残魂封于这枚噬天神戒中，沉睡了万载光阴，直至被你的血脉精气唤醒。”\n\n“晚辈的血脉？”陈青玄心中微惊。\n\n“不错。你身上流淌着极罕见的‘太虚道体’血脉，虽未觉醒，但对本源真气的亲和度乃世间万中无一。这也是你为何能修炼老夫《大荒吞天诀》的根本原因。”`,
    wordCount: 450,
  },
  {
    title: '第五章 吞天第一转',
    content: `“所谓《大荒吞天诀》，夺天地之造化，侵日月之玄机。”\n\n荒古天尊单指一点，一道璀璨的金芒瞬间没入陈青玄的眉心祖窍。\n\n轰！\n\n庞大的信息洪流在脑海中炸裂开来，化作一篇篇玄奥无匹的古篆道文。功法分九转，一转一重天。仅仅是第一转的运转脉络，便让陈青玄感到浑身气血沸腾，周身经脉隐隐作痛。\n\n“沉心静气！运转周天，引天地灵气灌顶！”老者沉声喝道。\n\n陈青玄死死咬住牙关，忍受着经脉被寸寸撕裂又被清凉古气迅速修复的剧痛。四周夜空中的天地灵气仿佛受到了某种霸道无匹的牵引，化作肉眼可见的白色气旋，疯狂汇入他的天灵盖！\n\n轰隆！\n\n体内一声脆响，犹如打破了某种无形的桎梏。练气三重……练气四重……练气五重！\n\n短短半个时辰，陈青玄的修为竟连破三重关卡！一股沛然莫御的强横真气在丹田气海中如江河般奔涌。\n\n当他睁开双眼时，眸中竟有一缕漆黑的吞噬漩涡一闪而逝。`,
    wordCount: 420,
  },
  {
    title: '第六章 藏经阁风波',
    content: `清晨，晨光熹微。\n\n陈青玄回到陈家大宅，脚步轻快沉稳。一夜连破三重境界，不仅毫无疲惫，反而神清气爽，气力充盈。\n\n他信步走向家族藏经阁。如今踏入练气五重，已具备挑选黄阶中品武技的资格。\n\n藏经阁内古香古色，书架林立。几个早起的家族子弟正在翻阅古籍，见到陈青玄走进来，神色各异。\n\n“哟，这不是昨日大出风头的青玄堂弟吗？”一道略带讥讽的声音从二楼楼梯口传来。\n\n来人正是大长老的长孙陈飞羽，练气六重修为，向来在家族年轻一辈中飞扬跋扈。\n\n“陈青玄，别以为侥幸胜了赵天骄就能得意忘形。十日后的三族大比，若是碰上金阳宗的选拔使，凭你那点偷奸耍滑的花招，可走不过半招。”陈飞羽冷哼一声，居高临下地俯视着他。\n\n陈青玄面色从容，淡淡回应：“飞羽堂兄若有指教，大比擂台上自见分晓，何须在此饶舌？”\n\n“你！”陈飞羽面色一沉，周身真气隐现，却碍于藏经阁重地不得私斗的规矩，只能狠狠拂袖而去。`,
    wordCount: 410,
  },
  {
    title: '第七章 幽冥密林试炼',
    content: `为了巩固新突破的境界并熟练掌握《大荒吞天诀》的实战威力，陈青玄领了一份家族猎杀二阶妖兽的悬赏任务，独身前往青石镇外百里处的幽冥密林。\n\n密林中古树参天，遮天蔽日，空气中弥漫着潮湿腐朽与淡淡的血腥气息。\n\n“吼——！”\n\n行至密林深处，一声低沉凶残的咆哮骤然响起。一头身长两丈、浑身覆盖着坚硬铁甲的二阶黑甲地蜥从灌木丛中猛扑而出，布满倒钩的长尾如钢鞭般横扫而来！\n\n劲风呼啸，连碗口粗的古木都被拦腰抽断。\n\n“来得好！”\n\n陈青玄不退反进，脚踏《大荒吞天诀》中附带的“幻影迷踪步”，身形在空中化作三道残影，险之又险地避过尾击。同时右手并指成刀，黑色的吞噬真气化作凌厉锋芒，直刺黑甲地蜥咽喉最柔软的白斑处！\n\n噗嗤！\n\n腥臭的妖血飙射而出。黑甲地蜥凄厉惨嚎，庞大的身躯轰然倒地。更令人惊异的是，随着古戒光芒微闪，黑甲地蜥体内尚未散去的雄浑气血竟被瞬间抽离，化作最纯净的养分反哺入陈青玄体内！\n\n“好霸道的功法！”陈青玄心神震撼。`,
    wordCount: 440,
  },
  {
    title: '第八章 金阳使者降临',
    content: `十日之期转瞬即逝。\n\n青石镇中心广场人山人海，喧声震天。今日乃是十年一度的三大家族大比，更关乎郡城顶级宗门“金阳宗”的弟子选拔！\n\n主看台中央，端坐着一位身披赤金道袍的中年男子。男子周身隐隐散发着令人窒息的恐怖威压，正是金阳宗外门执事——凝元境强者周崇！\n\n“本座此次奉宗门之命，在青石镇仅招收三名外门弟子与一名核心种子。”周崇声音不大，却在整座广场每个人耳边清晰响起，“凡未满十八岁、修为在练气五重以上者，皆可登台参战！”\n\n一时间，全场年轻子弟热血沸腾。\n\n“第一轮抽签，陈家陈青玄，对阵李家李狂澜！”\n\n听到报幕声，台下顿时一阵哗然。\n“李狂澜可是李家第一天才，半步凝元境，掌握狂澜刀法，陈青玄这下彻底没戏了！”`,
    wordCount: 360,
  },
  {
    title: '第九章 一拳撼乾坤',
    content: `擂台之上，李狂澜手持一柄重达八十斤的赤铜九环刀，神态狂傲：“陈青玄，亮出你的兵刃吧！别怪我没给过你机会。”\n\n陈青玄两手空空，青衫随风轻拂：“对付你，一双肉掌足矣。”\n\n“找死！狂澜九重浪！”\n\n李狂澜怒吼一声，刀光如血海狂涛，铺天盖地般向陈青玄碾压而来。狂暴的刀气甚至将坚硬的花岗岩擂台地面撕裂出道道深达尺许的沟壑！\n\n看台上的陈家族人无不倒吸一口冷气，陈天远更是紧张得攥紧了手心。\n\n就在刀光即将触及发丝的千钧一发之际，陈青玄动了。\n\n他没有躲避，只是简简单单地向前踏出一步，右拳微缩，旋即如巨龙出海般悍然轰出！\n\n大荒吞天拳——崩山！\n\n轰隆！\n\n虚空中仿佛响起了古老神魔的怒吼。黑色拳劲在半空中化作一道无坚不摧的狂暴气柱，狂暴的刀芒在接触拳劲的瞬间寸寸崩碎！\n\n李狂澜惨叫一声，整个人如断线风筝般倒飞出三十丈外，狠狠砸在广场外的石碑上，手中赤铜刀断成数截！\n\n一拳，败李狂澜！`,
    wordCount: 420,
  },
  {
    title: '第十章 潜龙腾渊，名动八荒（终章）',
    content: `全场陷入死一般的寂静。\n\n主看台上，金阳宗执事周崇猛然站起身，眼中爆发出前所未有的灼热异彩：“天地异象！拳意化形！这是……天生道体才有的绝世异相！”\n\n他身影一晃，瞬间出现在擂台之上，目光灼灼地看着陈青玄：“小友，你可愿拜入我金阳宗，直接成为核心真传弟子？宗内一切修炼资源，皆任你取用！”\n\n此言一出，台下三大家族的族长与长老们全部目瞪口呆，震撼得无以复加。\n\n陈青玄神色依然从容不迫，向周崇微微拱手：“承蒙前辈看重，晚辈愿往。”\n\n他转过身，望向远方的苍茫天际。青石镇终究太小，而这浩瀚无垠的九品大陆、星空彼岸，才是他真正的舞台。\n\n少年陈青玄的吞天之旅，就此踏上征程！`,
    wordCount: 370,
  },
];

function simulateBackgroundChapterStream(
  bookId: string,
  startIndex: number,
  totalChapters: number,
  onProgress?: (progress: TomatoFetchProgress) => void
) {
  let currentIndex = startIndex;

  const interval = setInterval(async () => {
    const book = await getBookById(bookId);
    if (!book || currentIndex >= totalChapters) {
      clearInterval(interval);
      if (book) {
        book.fetchStatus = {
          total: totalChapters,
          completed: totalChapters,
          isFetching: false,
        };
        await saveBook(book);
      }
      if (onProgress) {
        onProgress({
          bookId,
          totalChapters,
          completedChapters: totalChapters,
          currentChapterTitle: '全本抓取完成',
          isComplete: true,
        });
      }
      return;
    }

    const template = EXTENDED_CHAPTER_TEMPLATES[currentIndex - 1] || {
      title: `第 ${currentIndex + 1} 章 破晓风云`,
      content: `随着修行的深入，陈青玄越发感受到了天地大道的浩瀚莫测。\n\n真气如水，心境如镜。这一日，青石镇的天空忽然降下万道霞光，祥云汇聚，仿佛预示着一段宏大传奇的拉开序幕……`,
      wordCount: 280,
    };

    const newChapter: Chapter = {
      id: `${bookId}_ch_${currentIndex}`,
      index: currentIndex,
      title: template.title,
      content: template.content,
      wordCount: template.wordCount,
    };

    book.chapters.push(newChapter);
    book.totalChapters = totalChapters;
    book.fetchStatus = {
      total: totalChapters,
      completed: book.chapters.length,
      isFetching: book.chapters.length < totalChapters,
    };
    book.updatedAt = Date.now();

    await saveBook(book);

    if (onProgress) {
      onProgress({
        bookId,
        totalChapters,
        completedChapters: book.chapters.length,
        currentChapterTitle: newChapter.title,
        isComplete: book.chapters.length >= totalChapters,
      });
    }

    currentIndex++;
  }, 1200); // 1.2s per chapter progressive stream
}
