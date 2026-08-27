import fs from "node:fs/promises";
import { resolve } from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = resolve("D:/projects/company/chat-to-video/outputs/short-video-template-results-20260827");
const outputPath = resolve(outputDir, "短视频模板测试结果.xlsx");

const templates = [
  ["电商模特换装", "short-video-fashion-outfit-change", "生成一条16秒电商模特换装视频，使用模板默认人物、酒店内景、四套造型顺序和抖音快节奏。", 4, "通过", "触发正确；存在地点与标识扩写"],
  ["口播视频", "short-video-talking-head", "生成一条15秒办公室真人口播视频，使用模板默认人物、构图、灯光和动作。", 1, "通过", "触发正确；存在地点扩写"],
  ["探店视频", "short-video-store-visit", "生成一条12秒美食探店视频，使用模板默认三镜头、中文旁白、音效和背景音乐，不要字幕。", 3, "通过", "触发正确；视频提示词排除了背景配乐"],
  ["角卤视频", "short-video-jiaolu-food", "生成一条12秒角卤视频，使用模板默认酸辣鸡丝、门店排队和虚构成年女性进食三镜头。", 3, "通过", "触发正确；存在城市扩写"],
  ["神灯视频", "short-video-magic-lamp", "生成一条12秒沙漠神灯视频，使用模板默认发现、挖掘擦拭、蓝烟灯神现身三镜头。", 3, "通过", "人物国籍与地点发生关键漂移"],
  ["手持直播效果", "short-video-handheld-dv-vlog", "生成一条15秒手持MiniDV后台vlog，使用模板默认23岁韩国成年女性、对白和真实自拍效果。", 1, "通过", "对白被改写，场景被扩写"],
  ["电影效果", "short-video-film-look", "生成一条20秒写实电影质感短片，使用模板默认西域沙漠部落五镜头、35mm暖灰色调和环境音效，无背景音乐。", 5, "通过", "人物族群约束被弱化"],
];

const prompts = [
  ["电商模特换装", "short-video-fashion-outfit-change", 1, "video", "模板默认模特，23岁成年女性，面部与体态稳定，确保动作和服装无畸变、无布料拉伸、无遮挡；全身正面镜头，快速推进连续长镜头；模特以自然转身展示第一套造型（由侧向正面自然转身并略作停顿，衣摆与细节清晰可见）；上海浦东区高端酒店套房内景，前左方柔和主光，室内现代软装与中文指示牌可见，保持一贯酒店几何；展现服装全身轮廓、面料光泽、领口、袖口、印花位置与闭合方式，细节无遮挡；抖音快节奏电商陈列风格，色彩干净，背景轻微虚化，动作节奏利落；逐镜生成对白、旁白、环境声和同步音效，不生成背景配乐。酒店环境声，无背景配乐。一个连续镜头，适合裁切为4秒。"],
  ["电商模特换装", "short-video-fashion-outfit-change", 2, "video", "模板默认模特，23岁成年女性，面部与体态稳定，确保动作和服装无畸变、无布料拉伸、无遮挡；三分之二至全身镜头，快速拉远连续长镜头；模特以自然转身展示第二套造型（由近景侧面转至正面并短步后退展现下摆与剪裁）；上海浦东区高端酒店套房内景，前左方柔和主光，背景可见中文室内导示与窗外城市轮廓，保持酒店一致性；展示衣服的轮廓、面料纹理、领口与袖口细节，纽扣或拉链闭合方式清晰；抖音快节奏电商陈列风格，节奏紧凑，画面易于快速剪辑；逐镜生成对白、旁白、环境声和同步音效，不生成背景配乐。酒店环境声，无背景配乐。一个连续镜头，适合裁切为4秒。"],
  ["电商模特换装", "short-video-fashion-outfit-change", 3, "video", "模板默认模特，23岁成年女性，面部与体态稳定，确保动作和服装无畸变、无布料拉伸、无遮挡；全身跟随镜头，连续长镜头，跟随移动保持模特全身在画面内；模特以自然转身并向前短步展示第三套造型（侧转到前方并略微侧身展示细节），动作平稳以突出面料飘逸与剪裁；上海浦东区高端酒店套房内景，前左方柔和主光，室内现代软装一致，中文标识与窗帘质地可见；确保衣物的整体廓形、面料纹理、口袋和袖口细节可辨；抖音快节奏电商展示风格，画面利落、节拍感强；逐镜生成对白、旁白、环境声和同步音效，不生成背景配乐。酒店环境声，无背景配乐。一个连续镜头，适合裁切为4秒。"],
  ["电商模特换装", "short-video-fashion-outfit-change", 4, "video", "模板默认模特，23岁成年女性，面部与体态稳定，确保动作和服装无畸变、无布料拉伸、无遮挡；全身正面镜头，快速推进至定格收束连续长镜头；模特以自然转身并收束动作展示第四套造型（完成转身后摆出收束定格姿势，以凸显整体造型完成度）；上海浦东区高端酒店套房内景，前左方柔和主光，室内统一风格与中文装饰细节；凸显服装收尾细节、面料垂感、领口与配饰位置；抖音快节奏电商陈列与收束表现，画面适合形成结尾封面帧；逐镜生成对白、旁白、环境声和同步音效，不生成背景配乐。酒店环境声，无背景配乐。一个连续镜头，适合裁切为4秒。"],
  ["口播视频", "short-video-talking-head", 1, "video", "地点：上海市中心现代写字楼内的办公室，室内可见城市天际线轮廓以保持地区性但不指名具体地标。演员：一位约25岁的中国女性职业人士，面向镜头正面口播，半身中近景（胸肩以上），保持同一身份、发型、服装和坐姿贯穿全片。构图与背景：正面中近景，背景为轻微虚化的书架与整洁办公桌，留出画面下方安全区域以便后期放置信息卡。服装与道具：低饱和商务休闲服饰，简单首饰，无显著品牌或商标，办公桌上仅有常见办公用品（笔记本、笔架、手机静置）。灯光：温暖白色正面柔光，无明显面部阴影，整体色温自然，保持面部均匀曝光。表情与动作：温暖开场微笑，语速自然、情感亲切，手势节制，不遮挡嘴部，保持清晰口型以保证精准唇形同步；自然眨眼与呼吸。摄影指导：固定摄位，中近景构图，摄影机做一处“轻微慢推”以增强动态感（慢推幅度很小，整段持续），不切镜头，不改变镜头高度或光线方向。技术与时长：连续拍摄15秒，镜头全程可用于生成单段正面口播视频。音频指示（必须在生成中保留并与画面对应）：包含同步对白与办公室环境声（如轻微的键盘声、空调低噪、轻微房间回响），遵循统一处理：逐镜生成对白、旁白、环境声和同步音效，不生成背景配乐；本场景明确不包含任何背景音乐或配乐。模型与交付：为doubao-seedance-2.0模型准备的生成提示，生成可编辑的干净对白轨（供后期降噪/混音），避免面部或手部形变、唇形漂移、背景变形、对焦或曝光跳变，保留镜头下的自然细节与可编辑素材。"],
  ["探店视频", "short-video-store-visit", 1, "video", "地点：中国·上海市静安区，店名“老街小食铺”，画面可见中文门头招牌“老街小食铺”。用途：从门口推进展示门店环境。镜头与动作：广角到中景，单镜连续推进（推进移动，持续4秒），从街道前景推进穿过门口进入店内，展示木质柜台、明亮瓷砖墙面、点餐窗口、悬挂中文价目表与手写小黑板。可见人物与服饰：店员身着深蓝色围裙在柜台后活动，路人稀少且不进入画面中心。可见道具：收银机、菜单黑板、桌椅、布置整齐的调味瓶。连续性与限制：招牌、柜台布局、店员服饰在后续镜头中保持一致；不得出现重复人物、招牌文字变化或不合逻辑的空间跳切；避免食物或道具变形。音频指示：逐镜生成对白、旁白、环境声和同步音效，不生成背景配乐或配乐。场景音（合并共享指令）：门店环境声与中文旁白（旁白简短介绍店铺与招牌），无背景配乐。额外要求：不生成字幕。"],
  ["探店视频", "short-video-store-visit", 2, "video", "地点与店铺延续：上海市静安区“老街小食铺”，室内装饰与招牌保持一致。用途：展示冰箱中的新鲜食材。镜头与动作：中近景到特写，平移镜头（从左向右平移，持续4秒），打开玻璃冷藏柜，逐格展示摆放整齐的新鲜食材：当季蔬菜、海鲜与透明保鲜盒内的准备食材，细节可见冰霜与水珠。动作顺序：工作人员戴手套从冰箱取出一盒食材并短暂停留展示后放回，避免食材被挤压或变形。可见道具与标识：冰箱顶部或侧面贴有中文标签小条幅与价格标签，照明为冷白光。连续性与限制：冰箱位置、标签文本与食材类型应与店铺设定一致；不得出现不现实的冰箱几何、食材融合或复制错误。音频指示：逐镜生成对白、旁白、环境声和同步音效，不生成背景配乐或配乐。场景音（合并共享指令）：冰箱开启声与食材环境声（如塑料盒摩擦、冰霜滴落声），无背景配乐。额外要求：不生成字幕。"],
  ["探店视频", "short-video-store-visit", 3, "video", "地点与店铺延续：上海市静安区“老街小食铺”的用餐区，空间与前两镜保持连续关系。用途：成年情侣品尝美食并自然表达“好吃”。镜头与动作：中景固定机位（稳定的餐桌高度视角，持续4秒），画面中心为一对成年情侣（年龄约25–35岁，现代休闲装），一人用筷子夹起一口食物送入口中，咀嚼并自然微笑、低声说出“好吃”。动作顺序：夹取→咬一口→自然反应→相视微笑。道具与连续性：餐具为筷子与瓷碗，桌面摆放一致，人物服装与发型在镜头间保持一致；确保人物均为成年人，表情自然、不夸张。音频指示：逐镜生成对白、旁白、环境声和同步音效，不生成背景配乐或配乐。场景音（合并共享指令）：进食音效（咀嚼声、碗筷轻触）与中文旁白（简短品尝感受），无背景配乐。额外要求：不生成字幕。"],
  ["角卤视频", "short-video-jiaolu-food", 1, "video", "地点：成都市（虚构门店）内景近拍，门店品牌标识为中文“角卤熟食”在背景可见。画面主体：固定微距镜头，稳定无抖动，筷子夹起一份酸辣鸡丝的微距特写，鸡丝呈丝状，带有红环椒碎、紫色洋葱碎与黄色柠檬片，置于反光不锈钢碗中，汁液微亮。筷子为天然木制，避免筷子与食物融合或形变；食物质感真实，高细节。构图：浅景深，主体清晰、背景轻微虚化；暖色灯光，强调油亮质感和香辣视觉细节。动作：单一连续动作——筷子夹起并缓慢抬起至画面上方，动作流畅、无重影。样式与技术指令：高细节、真实质感、暖色调、固定微距镜头、避免食物变形或色彩失真。音频方向：逐镜生成对白、旁白、环境声和同步音效，不生成背景配乐。场景音：食物与餐具音效，清晰筷子摩擦与碗壁声；无背景配乐/无配乐。"],
  ["角卤视频", "short-video-jiaolu-food", 2, "video", "地点：成都市繁忙商圈街道外景，画面中为虚构“角卤熟食”门店外立面与中文招牌“角卤熟食”，橱窗贴有菜品海报（酸辣鸡丝）。画面主体：电影级平移（横向平移），从左向右缓慢横移穿过排队人群，展示门店外队列长度。人物：生成为非可识别的成年人（不同面孔、日常着装），保持自然队列密度、避免重复面孔和群组复制。建筑与街景：本地城市建筑风貌、路牌与中文街道标识，车辆为常见城市小车，整体区域风格与四川城市特征相容。构图与光线：日间自然光，色彩真实，动态范围平衡。动作：一个连贯平移动作，镜头稳定并保持对人群与招牌的可读性。样式与技术指令：电影级平移、高动态范围、真实人群、中文街道标牌、稳健跟焦。音频方向：逐镜生成对白、旁白、环境声和同步音效，不生成背景配乐。场景音：街道与排队环境声（说话声、脚步声、轻微车辆噪声）；无背景配乐/无配乐。"],
  ["角卤视频", "short-video-jiaolu-food", 3, "video", "地点：成都市“角卤熟食”门店内中景，桌上为不锈钢碗装酸辣鸡丝（红环椒、紫洋葱、柠檬片明确可见）。画面主体：固定中景镜头，一位虚构的成年年轻女性就坐在折叠营地椅上（普通休闲服），为非可识别身份的人物。动作：她用筷子夹起鸡丝并一口咬下，咀嚼与享受的连续动作清晰、自然，避免身体或食物畸变。表情自然但不可识别为真实人物，禁止名人或可识别肖像。光线：门店明亮暖光，突出食物色泽与口腔音效。构图与细节：中景稳定取景，桌面有餐巾与不锈钢碗，食物质感高细节，避免重复背景人物。样式与技术指令：固定中景、食物口腔音清晰、自然表情、真实材料质感。音频方向：逐镜生成对白、旁白、环境声和同步音效，不生成背景配乐。场景音：进食声与明亮门店环境声（轻微交谈与背景门店动线声）；无背景配乐/无配乐。"],
  ["神灯视频", "short-video-magic-lamp", 1, "video", "目标模型：doubao-seedance-2.0；地点：内蒙古·阿拉善沙漠。镜头说明：推进（慢推），单镜头连续动作，时长4秒，16:9。画面：成年汉族男性（约30-40岁，实用沙漠行装：浅色长袖衬衫、围巾、布鞋）沿金色砂丘行走，镜头推进至半埋的古铜色神灯（扁长形、表面有沙尘和轻微花纹），相机从人物背侧略偏右推进，停在灯嘴与人物视线连线处，保留清晰脚印与风吹起的细沙薄雾。风格：写实电影感、暖金色逆光、浅景深、细节可见铜绿与刻纹。动作链：注意→靠近→发现（发现为镜头结束点）。音频方向：逐镜生成对白、旁白、环境声和同步音效，不生成背景配乐或配乐。场景音（需合成）：脚步与风沙声；无背景配乐/无配乐。注意连续性：与后续镜头保持光线与灯的相对位置一致；勿在本镜头中提前显示烟或神灵实体。"],
  ["神灯视频", "short-video-magic-lamp", 2, "video", "目标模型：doubao-seedance-2.0；地点：内蒙古·阿拉善沙漠。镜头说明：过肩推进（近景手部/上半身），单镜头连续动作，时长4秒，16:9。画面：同一名成年汉族男性，从过肩视角靠近古铜神灯，用双手挖出并将灯提起，随后用袖口或布料擦拭壶身，壶口开始冒蓝色薄烟（烟量初起、呈丝状向右上方蔓延且不完全遮挡人物），灯表面细节与沙粒随动作掉落。动作链：挖→提→擦→烟雾开始（本镜头以烟雾初起作收尾）。风格：写实、触感强，手部皮肤纹理与灯面沙粒细节清晰。音频方向：逐镜生成对白、旁白、环境声和同步音效，不生成背景配乐或配乐。场景音（需合成）：刨沙、擦拭与烟雾音效；无背景配乐/无配乐。注意：保持与镜头1灯与阳光方向一致，烟的颜色与走向为后续镜头连续线索。"],
  ["神灯视频", "short-video-magic-lamp", 3, "video", "目标模型：doubao-seedance-2.0；地点：内蒙古·阿拉善沙漠。镜头说明：低位固定（牛仔高度，从三名成年人身后），单镜头连续动作，时长4秒，16:9。画面：三名成年人（包含先前发现者，均为成年汉族成年人）并排面向神灯与升起的蓝烟，镜头位于背后低位，捕捉烟雾在前景的流动与人物的即时反应（惊讶、后退或抬头）。灯神在蓝烟中逐步物化、呈现模糊轮廓与逐渐清晰的体态，但在本镜头结束前不得完全显现为完全清晰的人形；保留神秘感与因果连贯性。光线与色彩应与前两镜头保持一致，烟雾纹理连续。动作链：烟雾扩大→神灵逐渐显现→人物惊讶反应（以反应声与表情收尾）。音频方向：逐镜生成对白、旁白、环境声和同步音效，不生成背景配乐或配乐。场景音（需合成）：烟雾与惊讶反应声（低声惊呼、吸气声等）；无背景配乐/无配乐。注意：避免提前完整显示灯神的面部或特征，防止道具或人物穿插错误。"],
  ["手持直播效果", "short-video-handheld-dv-vlog", 1, "video", "首选模型：doubao-seedance-2.0；场景位置：上海某演出场馆后台走廊与化妆间外镜子（内景，舞台溢光、夕刻或夜间演出氛围）；人物与身份：23岁韩国成年女性，独自拍摄，持MiniDV摄像机，第一人称手持自拍视角；动作序列（连续单镜头、总时长约15秒）：摄像机在行走中无意启动，初始只捕捉到半张脸，她察觉后轻笑并说台词，边走边口述通过后台走廊，镜头在化妆镜前短暂停留，她用一只手调整闪亮耳环，注意到手在微颤并低声自语。台词（需逐字同步）：“啊，抱歉……还有大概一分钟就上场了。每次唱这首歌，还是会有点紧张，但也很熟悉。”（镜子前）“我上台前手总是很冷。”；相机与视觉细节：真实MiniDV质感（磁带颗粒感）、略微自动对焦猎焦、轻微曝光呼吸与高光泛光、温暖的DV色彩偏移、可见镜头边缘与握持手指、适度运动模糊与步行引起的构图变化、不要人工大幅稳定或去抖；取景与构图：第一人称高度，半脸与手臂自然进入画面，镜中反射可见面部表情与耳环动作，但不要出现第二摄像师的视角或镜头切换；服装与道具：艺人身着深色演出服，佩戴闪亮耳环，手持MiniDV摄像机，背景可见中文工作证与身着黑色后台工作服的工作人员、墙面中文指示牌（例如“后台通道”），保证场景细节一致于上海地区演出后台；音频指示（必须合并共享方向与本场批准音频）：逐镜生成对白、旁白、环境声和同步音效，不生成背景配乐。并且：同步自然对白与机身麦克风后台环境声，无背景配乐。明确要求：无背景配乐、无配乐、无配乐评分。情感与表演指示：自然、含蓄的紧张感，眨眼、呼吸、微笑与手部微颤可见，嘴唇与对白精准同步，避免美颜或人工主播化；技术交付：16:9，帧率接近MiniDV风格（约29.97fps），输出格式兼容FFmpeg处理，单镜头文件时长≤15秒，保持连续性与拍摄真实性。"],
  ["电影效果", "short-video-film-look", 1, "video", "地点：中国新疆塔里木盆地一处峡谷崖壁部落（虚构场景，基于中国西域地貌）。画面风格：35mm 写实电影质感，暖灰色调，细微胶片颗粒。时间：黎明薄雾。构图与运动：超宽镜头，极缓慢推进进入峡谷定居点，从赭土色悬崖与岩穴向内推入，远处可见酒红色帐篷、袅袅炊烟与一只站立的骆驼，数名居民稀疏出现。可见服饰与道具：粗毛毡、粗纹布头巾、皮革、绳索、石砌台阶。主要动作：缓慢推进揭示营地与骆驼的清晰关系，骆驼轻微喘息。相机指示：极缓慢推进，硬切到下一镜头。声音合成指令（共享）：逐镜生成对白、旁白、环境声和同步音效，排除背景音乐和配乐；场景专用声：晨风、远处人声与骆驼响鼻。明确：不含背景音乐或配乐。"],
  ["电影效果", "short-video-film-look", 2, "video", "地点：中国新疆塔里木盆地峡谷部落内院近景。画面风格：35mm 写实电影质感，暖灰色调，低调光与细腻颗粒。构图与运动：固定近景特写，画面集中于一组陶罐和铜壶放在石台上。可见道具细节：手工陶罐釉面细微裂纹，铜壶古朴铜绿，绳索与布片环绕。主要动作：器物随远处低频震颤产生轻微颤动并互相轻碰，产生金属与陶瓷的清脆响声。相机指示：固定，不移动，硬切到下一镜头。声音合成指令（共享）：逐镜生成对白、旁白、环境声和同步音效，排除背景音乐和配乐；场景专用声：器物轻碰、低频震颤与远处低鸣。明确：不含背景音乐或配乐。"],
  ["电影效果", "short-video-film-look", 3, "video", "地点：中国新疆塔里木盆地峡谷部落的家庭院落中景。画面风格：35mm 写实电影质感，暖灰色调，黎明柔光。构图与运动：固定中近景，聚焦一位年长的村中老妇（虚构人物，着仿传统粗布与头巾），正在揉面或处理食物。主要动作：老妇停下揉面，抬头凝视天空，面部细节显示突出的吸气与紧张。相机指示：固定，不移动，硬切到下一镜头。声音合成指令（共享）：逐镜生成对白、旁白、环境声和同步音效，排除背景音乐和配乐；场景专用声：粗重吸气、面团与器物的震颤声以及背景低鸣。明确：不含背景音乐或配乐。"],
  ["电影效果", "short-video-film-look", 4, "video", "地点：中国新疆塔里木盆地峡谷部落通道处的中景。画面风格：35mm 写实电影质感，暖灰色调，晨光侧逆光。构图与运动：固定中景，画面含一只骆驼和牵兽的成年少年（虚构人物，着粗布衣袍）。主要动作：骆驼率先察觉异样，侧身嘶鸣并拉紧绳索，少年随后回头反应。相机指示：固定，不移动，硬切到下一镜头。声音合成指令（共享）：逐镜生成对白、旁白、环境声和同步音效，排除背景音乐和配乐；场景专用声：踏蹄、骆驼嘶鸣、绳索摩擦与持续低频低鸣。明确：不含背景音乐或配乐。"],
  ["电影效果", "short-video-film-look", 5, "video", "地点：中国新疆塔里木盆地峡谷部落晒场中景。画面风格：35mm 写实电影质感，暖灰色调，晨风轻扫。构图与运动：固定中景，画面可见挂着的酒红与赭土色织毯与晾绳，成年妇人（虚构人物）在近景內。主要动作：织毯随地面低频震颤抖动，绳索轻摇，成年妇人抬头望向远方，神情警觉。相机指示：固定，不移动，镜头结束以硬切。声音合成指令（共享）：逐镜生成对白、旁白、环境声和同步音效，排除背景音乐和配乐；場景專用聲：织物摩擦、晾绳振动、震颤与持续低鸣。明确：不含背景音乐或配乐。"],
];

const issues = [
  ["电商模特换装", "中", "擅自增加“上海浦东区”、中文指示牌等未要求的地域信息。", "模板默认值应完整展开，但不应补充未提供的城市或文字标识。"],
  ["口播视频", "低", "擅自把办公室定位为上海市中心。", "未指定地点时保持通用办公室，不写具体城市。"],
  ["探店视频", "高", "擅自创建“上海静安区老街小食铺”，最终视频提示词还排除了初始要求的背景音乐。", "明确区分视频原声与独立配乐资产，并保持用户音频要求。"],
  ["角卤视频", "中", "擅自把虚构门店定位为成都。", "保留品牌和镜头结构，不补充城市。"],
  ["神灯视频", "高", "印度男子被改为汉族男性，地点被改成内蒙古阿拉善。", "锁定人物身份、国籍与空间默认值，评审阶段禁止语义替换。"],
  ["手持直播效果", "高", "原始对白被改写和缩短，并增加上海场馆、中文标牌。", "将模板台词作为需要逐字保留的默认内容，除非用户明确覆盖。"],
  ["电影效果", "高", "Sogdian/Turkic Silk-Road 人物约束被弱化为泛化的新疆部落居民。", "将族群、服饰与色卡锚点设为高优先级不可丢失约束。"],
  ["通用", "中", "部分提示词仍含“模板默认模特”等未展开占位表达。", "输出到视频模型前执行占位符完整性检查。"],
];

const workbook = Workbook.create();
const overview = workbook.worksheets.add("测试总览");
const promptSheet = workbook.worksheets.add("最终提示词");
const costSheet = workbook.worksheets.add("费用与验证");
const issueSheet = workbook.worksheets.add("问题清单");

const titleFill = "#3D4948";
const headerFill = "#697472";
const accentFill = "#E8E5DE";
const warningFill = "#EEE6D7";
const successFill = "#E1E7DF";
const dangerFill = "#E9DEDC";
const oddRowFill = "#F5F3EE";
const evenRowFill = "#EBEEEB";
const borderColor = "#D5D1C8";

function applyTitle(sheet, titleRange, subtitleRange, title, subtitle) {
  sheet.showGridLines = false;
  sheet.getRange(titleRange).merge();
  sheet.getRange(titleRange).values = [[title]];
  sheet.getRange(titleRange).format = {
    fill: titleFill,
    font: { bold: true, color: "#FFFFFF", size: 16 },
    verticalAlignment: "center",
  };
  sheet.getRange(subtitleRange).merge();
  sheet.getRange(subtitleRange).values = [[subtitle]];
  sheet.getRange(subtitleRange).format = {
    fill: "#ECEAE4",
    font: { color: "#5B6260", italic: true },
    verticalAlignment: "center",
  };
  sheet.getRange("A1:F1").format.rowHeight = 30;
  sheet.getRange("A2:F2").format.rowHeight = 24;
}

function applyHeader(range) {
  range.format = {
    fill: headerFill,
    font: { bold: true, color: "#FFFFFF" },
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: borderColor },
  };
  range.format.rowHeight = 28;
}

applyTitle(overview, "A1:F1", "A2:F2", "短视频模板测试结果", "真实文本模型双阶段规划；测试止于视频生成前，未生成或入队任何媒体。测试时间：2026-08-27");
overview.getRange("A4:F4").values = [["模板", "触发 Skill", "初始提示词", "最终提示词数", "状态", "测试备注"]];
overview.getRange(`A5:F${4 + templates.length}`).values = templates;
applyHeader(overview.getRange("A4:F4"));
overview.getRange("A5:F11").format = { verticalAlignment: "top", wrapText: true };
overview.getRange("D5:D11").format.numberFormat = "0";
overview.getRange("E5:E11").format = { fill: successFill, font: { bold: true, color: "#536653" }, horizontalAlignment: "center" };
overview.getRange("A4:F11").format.borders = { preset: "inside", style: "thin", color: borderColor };
overview.getRange("A:A").format.columnWidth = 18;
overview.getRange("B:B").format.columnWidth = 36;
overview.getRange("C:C").format.columnWidth = 58;
overview.getRange("D:D").format.columnWidth = 15;
overview.getRange("E:E").format.columnWidth = 12;
overview.getRange("F:F").format.columnWidth = 34;
overview.getRange("A5:F11").format.rowHeight = 58;
overview.freezePanes.freezeRows(4);
overview.tables.add("A4:F11", true, "TemplateOverviewTable");
for (let row = 5; row <= 11; row += 1) {
  overview.getRange(`A${row}:F${row}`).format.fill = row % 2 === 1 ? oddRowFill : evenRowFill;
}
applyHeader(overview.getRange("A4:F4"));
overview.getRange("E5:E11").format = { fill: successFill, font: { bold: true, color: "#536653" }, horizontalAlignment: "center" };

applyTitle(promptSheet, "A1:E1", "A2:E2", "最终提示词明细", "每一行对应一个即将提交给视频模型的镜头提示词；共20条。可按模板或镜头序号筛选。");
promptSheet.getRange("A4:E4").values = [["模板", "触发 Skill", "镜头序号", "资产类型", "最终提示词"]];
promptSheet.getRange(`A5:E${4 + prompts.length}`).values = prompts;
applyHeader(promptSheet.getRange("A4:E4"));
promptSheet.getRange(`A5:E${4 + prompts.length}`).format = { verticalAlignment: "top", wrapText: true };
promptSheet.getRange(`C5:C${4 + prompts.length}`).format.numberFormat = "0";
promptSheet.getRange(`A4:E${4 + prompts.length}`).format.borders = { preset: "inside", style: "thin", color: borderColor };
promptSheet.getRange("A:A").format.columnWidth = 18;
promptSheet.getRange("B:B").format.columnWidth = 36;
promptSheet.getRange("C:C").format.columnWidth = 12;
promptSheet.getRange("D:D").format.columnWidth = 14;
promptSheet.getRange("E:E").format.columnWidth = 110;
promptSheet.getRange(`A5:E${4 + prompts.length}`).format.rowHeight = 112;
promptSheet.freezePanes.freezeRows(4);
promptSheet.freezePanes.freezeColumns(2);
promptSheet.tables.add(`A4:E${4 + prompts.length}`, true, "FinalPromptsTable");
for (let row = 5; row <= 4 + prompts.length; row += 1) {
  promptSheet.getRange(`A${row}:E${row}`).format.fill = row % 2 === 1 ? oddRowFill : evenRowFill;
}
applyHeader(promptSheet.getRange("A4:E4"));

applyTitle(costSheet, "A1:F1", "A2:F2", "费用与验证", "预算和验证状态均来自本次实际测试记录；金额单位为美元。");
costSheet.getRange("A4:B4").values = [["费用项目", "金额（USD）"]];
costSheet.getRange("A5:A10").values = [["用户总预算"], ["测试前余额"], ["测试后余额"], ["实际总消耗"], ["模板批测消耗"], ["预算剩余"]];
costSheet.getRange("B5:B7").values = [[1], [37.42321], [36.955986]];
costSheet.getRange("B8").formulas = [["=B6-B7"]];
costSheet.getRange("B9").values = [[0.114268]];
costSheet.getRange("B10").formulas = [["=B5-B8"]];
applyHeader(costSheet.getRange("A4:B4"));
costSheet.getRange("A5:A10").format = { fill: accentFill, font: { bold: true } };
costSheet.getRange("B5:B10").format.numberFormat = "$0.000000";
costSheet.getRange("A4:B10").format.borders = { preset: "inside", style: "thin", color: borderColor };
costSheet.getRange("D4:F4").values = [["验证项", "结果", "说明"]];
costSheet.getRange("D5:F10").values = [
  ["模板触发", "7/7 通过", "全部命中预期 short-video-* Skill"],
  ["生成方式", "通过", "7 个模板均为 two_pass"],
  ["结构化校验", "通过", "首次与最终 Schema 校验均通过"],
  ["连通性脚本测试", "21/21 通过", "无失败、取消或跳过"],
  ["ESLint", "通过", "三个测试脚本无 lint 错误"],
  ["媒体生成", "未执行", "未生成或入队图片、音乐、音频、视频"],
];
applyHeader(costSheet.getRange("D4:F4"));
costSheet.getRange("D5:F10").format = { verticalAlignment: "top", wrapText: true };
costSheet.getRange("E5:E9").format = { fill: successFill, font: { bold: true, color: "#536653" }, horizontalAlignment: "center" };
costSheet.getRange("E10").format = { fill: warningFill, font: { bold: true, color: "#756243" }, horizontalAlignment: "center" };
costSheet.getRange("D4:F10").format.borders = { preset: "inside", style: "thin", color: borderColor };
costSheet.getRange("A:A").format.columnWidth = 24;
costSheet.getRange("B:B").format.columnWidth = 18;
costSheet.getRange("C:C").format.columnWidth = 5;
costSheet.getRange("D:D").format.columnWidth = 24;
costSheet.getRange("E:E").format.columnWidth = 18;
costSheet.getRange("F:F").format.columnWidth = 52;
costSheet.getRange("A5:F10").format.rowHeight = 34;
costSheet.freezePanes.freezeRows(4);

applyTitle(issueSheet, "A1:D1", "A2:D2", "提示词漂移与改进建议", "模板触发正确，但模型生成内容存在默认值丢失、无依据扩写或占位符未展开等问题。");
issueSheet.getRange("A4:D4").values = [["模板", "严重度", "发现", "建议"]];
issueSheet.getRange(`A5:D${4 + issues.length}`).values = issues;
applyHeader(issueSheet.getRange("A4:D4"));
issueSheet.getRange(`A5:D${4 + issues.length}`).format = { verticalAlignment: "top", wrapText: true };
issueSheet.getRange(`A4:D${4 + issues.length}`).format.borders = { preset: "inside", style: "thin", color: borderColor };
issueSheet.getRange("A:A").format.columnWidth = 20;
issueSheet.getRange("B:B").format.columnWidth = 12;
issueSheet.getRange("C:C").format.columnWidth = 58;
issueSheet.getRange("D:D").format.columnWidth = 58;
issueSheet.getRange(`A5:D${4 + issues.length}`).format.rowHeight = 66;
issueSheet.getRange("B5:B12").conditionalFormats.add("containsText", { text: "高", format: { fill: dangerFill, font: { bold: true, color: "#805B56" } } });
issueSheet.getRange("B5:B12").conditionalFormats.add("containsText", { text: "中", format: { fill: warningFill, font: { bold: true, color: "#756243" } } });
issueSheet.getRange("B5:B12").conditionalFormats.add("containsText", { text: "低", format: { fill: successFill, font: { bold: true, color: "#536653" } } });
issueSheet.freezePanes.freezeRows(4);
issueSheet.tables.add("A4:D12", true, "PromptIssuesTable");
for (let row = 5; row <= 12; row += 1) {
  issueSheet.getRange(`A${row}:D${row}`).format.fill = row % 2 === 1 ? oddRowFill : evenRowFill;
}
applyHeader(issueSheet.getRange("A4:D4"));

await fs.mkdir(outputDir, { recursive: true });

const overviewCheck = await workbook.inspect({
  kind: "table",
  range: "测试总览!A1:F11",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 6,
});
console.log("OVERVIEW_CHECK");
console.log(overviewCheck.ndjson);

const costCheck = await workbook.inspect({
  kind: "table",
  range: "费用与验证!A4:F10",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 6,
});
console.log("COST_CHECK");
console.log(costCheck.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log("ERROR_SCAN");
console.log(errors.ndjson);

for (const [sheetName, range, fileName, scale] of [
  ["测试总览", "A1:F11", "preview-overview.png", 1.2],
  ["最终提示词", "A1:E24", "preview-prompts.png", 0.8],
  ["费用与验证", "A1:F10", "preview-cost.png", 1.2],
  ["问题清单", "A1:D12", "preview-issues.png", 1.1],
]) {
  const preview = await workbook.render({ sheetName, range, scale, format: "png" });
  await fs.writeFile(resolve(outputDir, fileName), new Uint8Array(await preview.arrayBuffer()));
}

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);
console.log(`OUTPUT=${outputPath}`);
