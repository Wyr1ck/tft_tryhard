// "state" regroupe toutes les infos qui changent pendant que le quiz tourne.
// On evite les variables eparpillees partout : tout est ici, au meme endroit.
const state = {
  data: null,              // contenu de items.json une fois charge
  champData: null,         // contenu de champions.json une fois charge
  mode: null,               // null = pas encore dans un quiz, sinon 'items' ou 'champions'
  pendingMode: null,        // mode en cours de choix, avant d'avoir choisi entrainement/competitif
  gameMode: 'training',     // 'training' ou 'competitive'
  itemsEmblemFilter: 'with', // 'with' ou 'without' : filtre choisi dans le sous-menu "objets"
  itemQuestionType: null,   // 'forward' (composants -> objet) ou 'reverse' (objet -> composants)
  currentQuestion: null,    // question du mode "items" (forward) affichee en ce moment
  currentReverseItem: null, // objet du mode "items" (reverse) affiche en ce moment
  currentChampion: null,    // personnage du mode "champions" affiche en ce moment
  lastItemId: null,         // id du dernier objet pose en question (mode "objets"), pour ne pas le repeter
  lastChampionId: null,     // id du dernier personnage pose en question, pour ne pas le repeter
  // "Sac a pioche" : on tire dans une liste melangee sans remise, on ne remelange
  // un nouveau sac que quand il est vide. Ca garantit qu'on ne retombe jamais sur
  // le meme objet/personnage tant que tous les autres ne sont pas deja passes.
  itemBag: { key: null, queue: [] }, // key = filtre emblemes pour lequel le sac a ete prepare
  championBag: [],
  answered: false,         // empeche de valider 2 fois la meme question
  scores: {
    // Score du mode entrainement : reinitialise a chaque lancement de partie.
    items: { score: 0, questionCount: 0 },
    champions: { score: 0, questionCount: 0 },
  },
  competitive: {
    streak: 0,
    startTime: null,
  },
};

// On recupere une bonne fois pour toutes les elements HTML qu'on va manipuler.
const homeScreen = document.getElementById('home-screen');
const itemsSubmenuScreen = document.getElementById('items-submenu-screen');
const modeSubmenuScreen = document.getElementById('mode-submenu-screen');
const quizScreen = document.getElementById('quiz-screen');

const homeItemsBtn = document.getElementById('home-items');
const homeChampionsBtn = document.getElementById('home-champions');
const homeItemsHighscoreEl = document.getElementById('home-items-highscore');
const homeChampionsHighscoreEl = document.getElementById('home-champions-highscore');

const itemsSubmenuBackBtn = document.getElementById('items-submenu-back-btn');
const itemsWithEmblemsBtn = document.getElementById('items-with-emblems');
const itemsWithoutEmblemsBtn = document.getElementById('items-without-emblems');

const modeSubmenuBackBtn = document.getElementById('mode-submenu-back-btn');
const modeTrainingBtn = document.getElementById('mode-training');
const modeCompetitiveBtn = document.getElementById('mode-competitive');

const backHomeBtn = document.getElementById('back-home-btn');

const siteTitleEl = document.getElementById('site-title');

const showLeaderboardBtn = document.getElementById('show-leaderboard-btn');
const leaderboardScreen = document.getElementById('leaderboard-screen');
const leaderboardBackBtn = document.getElementById('leaderboard-back-btn');
const leaderboardItemsWithEl = document.getElementById('leaderboard-items-with');
const leaderboardItemsWithoutEl = document.getElementById('leaderboard-items-without');
const leaderboardChampionsEl = document.getElementById('leaderboard-champions');

const podiumItemsWithEl = document.getElementById('podium-items-with');
const podiumItemsWithoutEl = document.getElementById('podium-items-without');
const podiumChampionsEl = document.getElementById('podium-champions');

const homeItemsImgEl = document.getElementById('home-items-img');
const homeChampionsImgEl = document.getElementById('home-champions-img');
const itemsWithEmblemsImgEl = document.getElementById('items-with-emblems-img');
const itemsWithoutEmblemsImgEl = document.getElementById('items-without-emblems-img');

const scoreBarEl = document.getElementById('score-bar');
const scoreEl = document.getElementById('score');
const questionCountEl = document.getElementById('question-count');

const competitiveBarEl = document.getElementById('competitive-bar');
const streakEl = document.getElementById('streak');
const timerEl = document.getElementById('timer');
const highscoreEl = document.getElementById('highscore');

const quizCardEl = document.getElementById('quiz-card');
const promptEl = document.getElementById('prompt-text');
const componentsEl = document.getElementById('components');
const answersEl = document.getElementById('answers');
const feedbackEl = document.getElementById('feedback');
const nextBtn = document.getElementById('next-btn');
const submitBtn = document.getElementById('submit-btn');
const retryBtn = document.getElementById('retry-btn');

// ---------------------------------------------------------------------------
// Tableau des scores partage (Firebase Firestore)
// ---------------------------------------------------------------------------

// Cette cle n'est pas un secret : elle est censee etre visible dans le code
// public d'un site. La vraie securite vient des regles Firestore (cote serveur).
const firebaseConfig = {
  apiKey: 'AIzaSyAfIqIWBeos1PMvAKvuU9lRdoiPDUb3KJk',
  authDomain: 'tft-tryhard.firebaseapp.com',
  projectId: 'tft-tryhard',
  storageBucket: 'tft-tryhard.firebasestorage.app',
  messagingSenderId: '133512694133',
  appId: '1:133512694133:web:96215d5e75cee894b9ab3c',
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Chaque categorie a sa propre collection ("tiroir") plutot qu'une seule
// collection filtree : ca evite d'avoir a creer un index compose dans
// Firestore. Categorie = 'items_with', 'items_without' ou 'champions' (les
// objets "avec" et "sans" emblemes sont 2 pools de questions differents, donc
// 2 classements distincts).
function getScoresCollectionName(category) {
  return `scores_${category}`;
}

// Deduit la categorie de score actuelle a partir de l'etat en cours.
function getScoreCategory() {
  if (state.mode !== 'items') return state.mode;
  return state.itemsEmblemFilter === 'without' ? 'items_without' : 'items_with';
}

async function submitScoreToLeaderboard(category, pseudo, timeMs) {
  await db.collection(getScoresCollectionName(category)).add({
    pseudo: pseudo.trim().slice(0, 20),
    timeMs,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

async function fetchTopScores(category, limitCount = 10) {
  const snapshot = await db
    .collection(getScoresCollectionName(category))
    .orderBy('timeMs', 'asc')
    .limit(limitCount)
    .get();
  return snapshot.docs.map((doc) => doc.data());
}

// Echappe le texte avant de l'inserer en HTML : indispensable car le pseudo
// vient d'un autre joueur, on ne peut pas lui faire confiance telle quelle.
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Charge les fichiers JSON avec fetch (comme un "GET http" fait par le navigateur).
// fetch() est asynchrone : il renvoie une Promise, d'ou le "await".
async function loadData() {
  const [itemsResponse, champResponse] = await Promise.all([
    fetch('data/items.json'),
    fetch('data/champions.json'),
  ]);
  state.data = await itemsResponse.json();
  state.champData = await champResponse.json();
}

// Retrouve le nom lisible d'un composant a partir de son id (ex: "bf_sword" -> "B.F. Sword").
function getComponentName(id) {
  return state.data.components.find((c) => c.id === id).name;
}

function getComponentNameEn(id) {
  return state.data.components.find((c) => c.id === id).nameEn || '';
}

// Construit le petit bloc "Nom francais (Nom anglais)". La partie anglaise est
// omise si elle n'est pas encore renseignee dans le JSON.
function formatNameWithEn(nameFr, nameEn) {
  const enHtml = nameEn ? `<span class="name-en">(${nameEn})</span>` : '';
  return `<span class="name-block"><span class="name-fr">${nameFr}</span>${enHtml}</span>`;
}

// Convention : l'image d'un composant/objet/personnage doit s'appeler "<id>.png"
// et etre placee dans le bon dossier. Pas besoin de toucher au JSON ni au JS
// pour ajouter une image : il suffit de deposer le fichier au bon endroit.
function getComponentImagePath(id) {
  return `assets/images/components/${id}.png`;
}

function getItemImagePath(id) {
  return `assets/images/items/${id}.png`;
}

function getChampionImagePath(id) {
  return `assets/images/champions/${id}.png`;
}

// Si le fichier image n'existe pas encore, on cache juste la balise <img>
// au lieu d'afficher l'icone "image cassee" du navigateur.
function hideImageOnError(imgEl) {
  imgEl.addEventListener('error', () => {
    imgEl.style.display = 'none';
  });
}

// Melange un tableau en place (algorithme de Fisher-Yates).
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Choisit une image au hasard dans un pool (objets ou personnages) pour
// illustrer une carte de choix. Comme certaines entrees n'ont pas encore de
// visuel, l'ordre melange sert de liste de repli : si une image casse, on
// tente la suivante, jusqu'a en trouver une valide.
function setRandomCardImage(imgEl, pool, getPathFn) {
  const order = shuffle([...pool]);

  function tryNext(index) {
    if (index >= order.length) {
      imgEl.style.display = 'none';
      return;
    }
    imgEl.style.display = '';
    imgEl.onerror = () => tryNext(index + 1);
    imgEl.src = getPathFn(order[index].id);
  }

  tryNext(0);
}

function randomizeHomeCardImages() {
  if (!state.data || !state.champData) return;
  setRandomCardImage(homeItemsImgEl, state.data.items, getItemImagePath);
  setRandomCardImage(homeChampionsImgEl, state.champData.champions, getChampionImagePath);
}

function randomizeItemsSubmenuImages() {
  if (!state.data) return;
  setRandomCardImage(itemsWithEmblemsImgEl, state.data.items.filter(isEmblemFamily), getItemImagePath);
  setRandomCardImage(
    itemsWithoutEmblemsImgEl,
    state.data.items.filter((item) => !isEmblemFamily(item)),
    getItemImagePath
  );
}

// ---------------------------------------------------------------------------
// Mode "Combos d'objets" (QCM a 4 choix, une seule bonne reponse)
// ---------------------------------------------------------------------------

// Un objet fabrique avec Spatule ou Poele a frire est un embleme (ou un objet
// Tacticien). On s'en sert pour ne jamais melanger ces objets-la avec les
// objets "normaux" dans les choix de reponse.
const EMBLEM_COMPONENT_IDS = ['spatule', 'poele_a_frire'];

function isEmblemFamily(item) {
  return item.components.some((id) => EMBLEM_COMPONENT_IDS.includes(id));
}

// Respecte le choix fait dans le sous-menu "objets" : avec ou sans emblemes.
function getItemPool() {
  if (state.itemsEmblemFilter === 'without') {
    return state.data.items.filter((item) => !isEmblemFamily(item));
  }
  return state.data.items;
}

// Tire un objet au hasard via un "sac a pioche" : on melange tout le pool une
// fois, on pioche dedans sans remise, et on ne remelange un nouveau sac que
// quand il est vide. Garantit qu'on ne retombe pas sur le meme objet tant que
// tous les autres n'y sont pas deja passes (contrairement a un tirage 100%
// aleatoire, qui peut statistiquement retomber plusieurs fois sur le meme).
function pickRandomItem() {
  const items = getItemPool();
  const poolKey = state.itemsEmblemFilter;

  if (state.itemBag.key !== poolKey || state.itemBag.queue.length === 0) {
    state.itemBag.key = poolKey;
    state.itemBag.queue = shuffle(items.map((item) => item.id));
    // Evite qu'un nouveau sac commence par le meme objet que la fin du precedent.
    if (state.itemBag.queue.length > 1 && state.itemBag.queue[0] === state.lastItemId) {
      const swapIndex = 1 + Math.floor(Math.random() * (state.itemBag.queue.length - 1));
      [state.itemBag.queue[0], state.itemBag.queue[swapIndex]] = [
        state.itemBag.queue[swapIndex],
        state.itemBag.queue[0],
      ];
    }
  }

  const nextId = state.itemBag.queue.shift();
  state.lastItemId = nextId;
  return items.find((item) => item.id === nextId);
}

// Construit les 4 choix affiches : le bon objet + 3 "distracteurs" pris au hasard,
// dans la meme famille (emblemes vs objets normaux) que la bonne reponse.
function buildItemChoices(correctItem) {
  const sameFamily = isEmblemFamily(correctItem);
  const pool = state.data.items.filter(
    (item) => item.id !== correctItem.id && isEmblemFamily(item) === sameFamily
  );
  shuffle(pool);
  const picked = [correctItem, ...pool.slice(0, 3)];
  return shuffle(picked).map((item) => ({
    id: item.id,
    label: item.name,
    labelEn: item.nameEn || '',
    imagePath: getItemImagePath(item.id),
  }));
}

function buildItemQuestion() {
  const item = pickRandomItem();
  const [comp1, comp2] = item.components;
  const subjectHtml = `
    <span class="chip"><img class="chip-icon" src="${getComponentImagePath(comp1)}" alt=""> ${formatNameWithEn(getComponentName(comp1), getComponentNameEn(comp1))}</span>
    <span class="chip-plus">+</span>
    <span class="chip"><img class="chip-icon" src="${getComponentImagePath(comp2)}" alt=""> ${formatNameWithEn(getComponentName(comp2), getComponentNameEn(comp2))}</span>
  `;

  return {
    correctId: item.id,
    promptText: 'Quel objet obtient-on avec :',
    subjectHtml,
    choices: buildItemChoices(item),
    feedbackImage: getItemImagePath(item.id),
    effectText: item.effect,
  };
}

// Affiche la question "objets" dans le sens classique : composants -> objet,
// sujet + 4 boutons de reponse.
function renderItemForwardQuestion() {
  const question = buildItemQuestion();
  state.currentQuestion = question;

  promptEl.textContent = question.promptText;
  componentsEl.innerHTML = question.subjectHtml;
  componentsEl.querySelectorAll('.chip-icon').forEach(hideImageOnError);

  answersEl.className = 'answers';
  answersEl.innerHTML = '';
  question.choices.forEach((choice) => {
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.dataset.choiceId = choice.id;
    const iconHtml = choice.imagePath
      ? `<img class="answer-icon" src="${choice.imagePath}" alt="">`
      : '';
    btn.innerHTML = `${iconHtml}${formatNameWithEn(choice.label, choice.labelEn)}`;
    const iconEl = btn.querySelector('.answer-icon');
    if (iconEl) hideImageOnError(iconEl);
    btn.addEventListener('click', () => handleItemAnswer(choice.id, btn));
    answersEl.appendChild(btn);
  });
}

// Appele quand le joueur clique sur une reponse en mode "objets".
function handleItemAnswer(choiceId, btnEl) {
  if (state.answered) return;
  state.answered = true;

  const question = state.currentQuestion;
  const isCorrect = choiceId === question.correctId;
  const titleText = isCorrect ? 'Correct !' : 'Incorrect !';
  const iconHtml = `<img class="feedback-icon" src="${question.feedbackImage}" alt="" onerror="this.style.display='none'">`;

  // En competitif, on n'affiche l'effet que si la partie se termine (mauvaise
  // reponse) : pas besoin de lire une explication quand on enchaine les
  // bonnes reponses, ca ferait juste sauter la taille du cadre pour rien.
  const showDetails = state.gameMode !== 'competitive' || !isCorrect;
  feedbackEl.innerHTML = `
    <div class="feedback-title">${iconHtml}${titleText}</div>
    ${showDetails ? `<div class="feedback-effect">${question.effectText || 'Effet non renseigne.'}</div>` : ''}
  `;
  feedbackEl.className = isCorrect ? 'feedback correct' : 'feedback incorrect';

  // Quoi qu'il arrive, on met en evidence la bonne reponse et on bloque les boutons.
  [...answersEl.children].forEach((btn) => {
    btn.disabled = true;
    if (btn.dataset.choiceId === question.correctId) {
      btn.classList.add('correct');
    } else if (btn === btnEl) {
      btn.classList.add('incorrect');
    }
  });

  finishQuestion(isCorrect);
}

const ITEM_REVERSE_OPTIONS_COUNT = 4;

// Construit la liste de composants proposee comme cases a cocher : les vrais
// composants de l'objet + juste assez de composants au hasard pour arriver a 4.
// Si un objet se fabrique avec 2 fois le meme composant (ex: Armure de Warmog),
// ce composant apparait deux fois dans la liste : il faut cocher les 2 cases
// pour valider, sinon on ne saurait jamais qu'il en faut 2.
// Si l'objet n'est pas un embleme/Tacticien, on ne propose jamais Spatule ou
// Poele a frire comme "faux" composant : ils ne servent jamais a fabriquer
// un objet normal, ce serait un choix absurde.
function buildComponentOptions(item) {
  const correctEntries = item.components.map((id) => ({
    ...state.data.components.find((c) => c.id === id),
    isCorrect: true,
  }));

  let wrongPool = state.data.components.filter((c) => !item.components.includes(c.id));
  if (!isEmblemFamily(item)) {
    wrongPool = wrongPool.filter((c) => !EMBLEM_COMPONENT_IDS.includes(c.id));
  }
  shuffle(wrongPool);
  const neededWrong = Math.max(0, ITEM_REVERSE_OPTIONS_COUNT - correctEntries.length);

  // Si l'objet se fabrique avec 2 fois le meme composant, la bonne reponse
  // serait la seule paire de cases identiques parmi les 4 : trop facile a
  // reperer sans meme connaitre la recette. On duplique donc aussi un
  // composant au hasard parmi les fausses reponses.
  const isDuplicateRecipe = correctEntries.length === 2 && correctEntries[0].id === correctEntries[1].id;

  const wrongEntries =
    isDuplicateRecipe && neededWrong >= 2
      ? Array.from({ length: neededWrong }, () => ({ ...wrongPool[0], isCorrect: false }))
      : wrongPool.slice(0, neededWrong).map((c) => ({ ...c, isCorrect: false }));

  // On donne une cle unique a chaque case (slotKey) : deux cases peuvent
  // representer le meme composant (id) mais restent 2 elements distincts.
  return shuffle([...correctEntries, ...wrongEntries]).map((entry, index) => ({
    ...entry,
    slotKey: `${entry.id}__${index}`,
  }));
}

// Affiche la question "objets" dans le sens inverse : objet -> composants,
// avec des cases a cocher (meme principe que le mode "personnages").
function renderItemReverseQuestion() {
  const item = pickRandomItem();
  state.currentReverseItem = item;

  promptEl.textContent = 'Avec quels composants peut-on fabriquer cet objet :';
  componentsEl.innerHTML = `
    <span class="chip"><img class="chip-icon" src="${getItemImagePath(item.id)}" alt=""> ${formatNameWithEn(item.name, item.nameEn)}</span>
  `;
  componentsEl.querySelectorAll('.chip-icon').forEach(hideImageOnError);

  answersEl.className = 'answers trait-list';
  answersEl.innerHTML = '';
  buildComponentOptions(item).forEach((comp) => {
    const option = document.createElement('label');
    option.className = 'trait-option';
    option.dataset.slotKey = comp.slotKey;
    option.dataset.isCorrect = comp.isCorrect ? '1' : '0';
    option.innerHTML = `
      <input type="checkbox" value="${comp.slotKey}">
      <img class="answer-icon" src="${getComponentImagePath(comp.id)}" alt="">
      <span class="trait-option-text">
        <span class="trait-name">${formatNameWithEn(comp.name, comp.nameEn)}</span>
      </span>
    `;
    hideImageOnError(option.querySelector('.answer-icon'));
    answersEl.appendChild(option);
  });

  submitBtn.classList.remove('hidden');
}

// Appele quand le joueur clique sur "Valider" en mode "objets" (sens inverse).
// Chaque case est independante (voir buildComponentOptions) : une reponse est
// bonne seulement si toutes les cases "correctes" sont cochees et aucune "fausse".
function handleItemReverseSubmit() {
  if (state.answered) return;
  state.answered = true;

  const item = state.currentReverseItem;
  const options = [...answersEl.children];
  const checkedSlotKeys = new Set(
    [...answersEl.querySelectorAll('input[type="checkbox"]:checked')].map((cb) => cb.value)
  );

  const isCorrect = options.every((option) => {
    const wasChecked = checkedSlotKeys.has(option.dataset.slotKey);
    const isRightComponent = option.dataset.isCorrect === '1';
    return wasChecked === isRightComponent;
  });

  options.forEach((option) => {
    const checkbox = option.querySelector('input[type="checkbox"]');
    checkbox.disabled = true;
    const wasChecked = checkedSlotKeys.has(option.dataset.slotKey);
    const isRightComponent = option.dataset.isCorrect === '1';

    if (isRightComponent) {
      option.classList.add(wasChecked ? 'correct' : 'missed');
      checkbox.checked = true;
    } else if (wasChecked) {
      option.classList.add('wrong');
    } else {
      option.classList.add('hidden');
    }
  });

  const correctOptions = [...answersEl.querySelectorAll('.trait-option.correct')];
  const wrongOptions = [...answersEl.querySelectorAll('.trait-option.wrong')];
  answersEl.prepend(...correctOptions);
  answersEl.append(...wrongOptions);

  const titleText = isCorrect ? 'Correct !' : 'Incorrect !';
  const iconHtml = `<img class="feedback-icon" src="${getItemImagePath(item.id)}" alt="" onerror="this.style.display='none'">`;
  const showDetails = state.gameMode !== 'competitive' || !isCorrect;
  feedbackEl.innerHTML = `
    <div class="feedback-title">${iconHtml}${titleText}</div>
    ${showDetails ? `<div class="feedback-effect">${item.effect || 'Effet non renseigne.'}</div>` : ''}
  `;
  feedbackEl.className = isCorrect ? 'feedback correct' : 'feedback incorrect';

  finishQuestion(isCorrect);
}

// Choisit au hasard le sens de la question "objets" (environ 50/50 a chaque fois,
// pas une stricte alternance).
function renderItemQuestion() {
  state.itemQuestionType = Math.random() < 0.5 ? 'forward' : 'reverse';
  if (state.itemQuestionType === 'forward') {
    renderItemForwardQuestion();
  } else {
    renderItemReverseQuestion();
  }
}

// ---------------------------------------------------------------------------
// Mode "Traits de personnages" (cases a cocher, plusieurs bonnes reponses)
// ---------------------------------------------------------------------------

const TRAIT_OPTIONS_COUNT = 6;

// Tire un personnage au hasard via le meme principe de "sac a pioche" que
// pickRandomItem() (voir son commentaire pour le detail).
function pickRandomChampion() {
  const champions = state.champData.champions;

  if (state.championBag.length === 0) {
    state.championBag = shuffle(champions.map((c) => c.id));
    if (state.championBag.length > 1 && state.championBag[0] === state.lastChampionId) {
      const swapIndex = 1 + Math.floor(Math.random() * (state.championBag.length - 1));
      [state.championBag[0], state.championBag[swapIndex]] = [
        state.championBag[swapIndex],
        state.championBag[0],
      ];
    }
  }

  const nextId = state.championBag.shift();
  state.lastChampionId = nextId;
  return champions.find((c) => c.id === nextId);
}

// Construit la liste de traits proposee comme cases a cocher : tous les vrais
// traits du personnage + juste assez de traits au hasard pour arriver a 6.
function buildTraitOptions(champion) {
  const correctIds = new Set(champion.traits);
  const correctTraits = state.champData.traits.filter((t) => correctIds.has(t.id));
  const wrongPool = shuffle(state.champData.traits.filter((t) => !correctIds.has(t.id)));
  const neededWrong = Math.max(0, TRAIT_OPTIONS_COUNT - correctTraits.length);
  const wrongTraits = wrongPool.slice(0, neededWrong);
  return shuffle([...correctTraits, ...wrongTraits]);
}

// Affiche la question "personnages" : le personnage + une liste de cases a cocher.
function renderChampionQuestion() {
  const champion = pickRandomChampion();
  state.currentChampion = champion;

  promptEl.textContent = 'Quels sont les traits de ce personnage :';
  componentsEl.innerHTML = `
    <div class="champion-reveal">
      <img class="champion-reveal-img" src="${getChampionImagePath(champion.id)}" alt="">
      <span class="champion-reveal-name">
        ${champion.name}
        <span class="champion-cost">${champion.cost} <span class="champion-cost-star">★</span></span>
      </span>
    </div>
  `;
  componentsEl.querySelectorAll('.champion-reveal-img').forEach(hideImageOnError);

  answersEl.className = 'answers trait-list';
  answersEl.innerHTML = '';
  buildTraitOptions(champion).forEach((trait) => {
    const option = document.createElement('label');
    option.className = 'trait-option';
    option.dataset.traitId = trait.id;
    option.innerHTML = `
      <input type="checkbox" value="${trait.id}">
      <span class="trait-option-text">
        <span class="trait-name">${trait.name}</span>
      </span>
    `;
    answersEl.appendChild(option);
  });

  submitBtn.classList.remove('hidden');
}

// Appele quand le joueur clique sur "Valider" en mode "personnages".
function handleChampionSubmit() {
  if (state.answered) return;
  state.answered = true;

  const champion = state.currentChampion;
  const correctIds = new Set(champion.traits);
  const checkedIds = new Set(
    [...answersEl.querySelectorAll('input[type="checkbox"]:checked')].map((cb) => cb.value)
  );

  // Bonne reponse seulement si les cases cochees sont exactement les bons traits.
  const isCorrect =
    checkedIds.size === correctIds.size && [...checkedIds].every((id) => correctIds.has(id));

  // Apres validation :
  // - bon trait coche -> vert (trouve)
  // - bon trait non coche -> couleur "manque" (c'etait la bonne reponse, ratee)
  // - mauvais trait coche -> rouge, sans definition
  // - mauvais trait non coche -> cache
  // Les bons traits (trouves ou manques) affichent leur definition, sauf en
  // competitif quand la serie continue (voir showDetails plus bas) : pas
  // besoin de lire une definition entre 2 questions qu'on enchaine vite.
  const showDetails = state.gameMode !== 'competitive' || !isCorrect;
  [...answersEl.children].forEach((option) => {
    const traitId = option.dataset.traitId;
    const checkbox = option.querySelector('input[type="checkbox"]');
    checkbox.disabled = true;
    const wasChecked = checkedIds.has(traitId);
    const isRightTrait = correctIds.has(traitId);

    if (isRightTrait) {
      option.classList.add(wasChecked ? 'correct' : 'missed');
      // Meme si le joueur ne l'a pas cochee, on affiche la case cochee pour
      // montrer que c'etait aussi une bonne reponse attendue.
      checkbox.checked = true;
      if (showDetails) {
        const trait = state.champData.traits.find((t) => t.id === traitId);
        const defEl = document.createElement('span');
        defEl.className = 'trait-def';
        defEl.textContent = trait.definition || 'Definition a venir.';
        option.querySelector('.trait-option-text').appendChild(defEl);
      }
    } else if (wasChecked) {
      option.classList.add('wrong');
    } else {
      option.classList.add('hidden');
    }
  });

  // Reorganise la liste pour la lisibilite : les bonnes reponses trouvees
  // (vert) remontent en haut, les mauvaises reponses (rouge) descendent en bas.
  const correctOptions = [...answersEl.querySelectorAll('.trait-option.correct')];
  const wrongOptions = [...answersEl.querySelectorAll('.trait-option.wrong')];
  answersEl.prepend(...correctOptions);
  answersEl.append(...wrongOptions);

  const titleText = isCorrect ? 'Correct !' : 'Incorrect !';
  const iconHtml = `<img class="feedback-icon wide" src="${getChampionImagePath(champion.id)}" alt="" onerror="this.style.display='none'">`;
  feedbackEl.innerHTML = `<div class="feedback-title">${iconHtml}${titleText}</div>`;
  feedbackEl.className = isCorrect ? 'feedback correct' : 'feedback incorrect';

  finishQuestion(isCorrect);
}

// ---------------------------------------------------------------------------
// Mode de jeu : entrainement (score classique) ou competitif (serie + chrono)
// ---------------------------------------------------------------------------

// Appelee par les 3 handlers de reponse une fois qu'on sait si la reponse est
// correcte. En entrainement, met a jour le score et propose la question
// suivante. En competitif, delegue a handleCompetitiveResult.
function finishQuestion(isCorrect) {
  submitBtn.classList.add('hidden');

  if (state.gameMode === 'competitive') {
    handleCompetitiveResult(isCorrect);
    return;
  }

  const progress = state.scores[state.mode];
  progress.questionCount++;
  if (isCorrect) progress.score++;
  updateScoreBar();
  nextBtn.classList.remove('hidden');
}

// Formatte un nombre de millisecondes en "MM:SS.d" (ex: 01:23.4).
function formatTime(ms) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(1);
  return `${String(minutes).padStart(2, '0')}:${seconds.padStart(4, '0')}`;
}

// (Re)demarre la serie competitive : serie a 0, chrono relance en interne.
// Le temps ne s'affiche plus en direct (ca redessinait le chiffre 10 fois
// par seconde, ce qui faisait ramer certains telephones) : on garde juste
// l'heure de depart en memoire, le temps reel n'apparait qu'a la fin de la
// partie (victoire ou defaite), voir finishCompetitiveRun().
function startCompetitiveTimer() {
  state.competitive.streak = 0;
  state.competitive.startTime = Date.now();
  streakEl.textContent = '0';
  timerEl.textContent = '--:--';
}

function getHighscoreMs(category) {
  const raw = localStorage.getItem(`tft_${category}_highscore_ms`);
  return raw !== null ? parseInt(raw, 10) : null;
}

function updateHighscoreDisplay() {
  const ms = getHighscoreMs(getScoreCategory());
  highscoreEl.textContent = ms !== null ? formatTime(ms) : '--';
}

// La carte d'accueil "Combos d'objets" precede le choix avec/sans emblemes :
// on y affiche le meilleur des 2 records, faute de savoir lequel afficher.
function updateHomeHighscores() {
  const itemsMs = [getHighscoreMs('items_with'), getHighscoreMs('items_without')]
    .filter((ms) => ms !== null)
    .sort((a, b) => a - b)[0];
  const champMs = getHighscoreMs('champions');
  homeItemsHighscoreEl.textContent = itemsMs !== undefined ? formatTime(itemsMs) : '--';
  homeChampionsHighscoreEl.textContent = champMs !== null ? formatTime(champMs) : '--';
}

// Appelee a chaque reponse en mode competitif : fait avancer la serie, ou
// termine immediatement la partie a la moindre erreur.
function handleCompetitiveResult(isCorrect) {
  if (!isCorrect) {
    finishCompetitiveRun(false);
    return;
  }

  state.competitive.streak++;
  streakEl.textContent = state.competitive.streak;

  if (state.competitive.streak >= 30) {
    finishCompetitiveRun(true);
  } else {
    nextBtn.classList.remove('hidden');
  }
}

// Affiche soit un message de victoire (avec record eventuel), soit un
// message de game over. C'est ici que le temps final est calcule et
// affiche pour la premiere fois (voir startCompetitiveTimer()).
function finishCompetitiveRun(won) {
  const elapsedMs = Date.now() - state.competitive.startTime;
  const category = getScoreCategory();
  // Premiere (et seule) mise a jour du temps affiche dans la barre : il
  // restait sur "--:--" pendant toute la partie.
  timerEl.textContent = formatTime(elapsedMs);

  if (won) {
    const key = `tft_${category}_highscore_ms`;
    const currentBest = getHighscoreMs(category);
    const isNewRecord = currentBest === null || elapsedMs < currentBest;
    if (isNewRecord) localStorage.setItem(key, String(elapsedMs));

    const banner = document.createElement('div');
    banner.className = 'victory-banner';
    banner.innerHTML = `
      <div class="victory-title">Bravo !</div>
      <div class="victory-time">${formatTime(elapsedMs)}</div>
      ${isNewRecord ? '<div class="victory-note">Nouveau record !</div>' : ''}
      <div class="leaderboard-submit">
        <input type="text" id="pseudo-input" placeholder="Ton pseudo" maxlength="20">
        <button id="submit-score-btn">Enregistrer au tableau des scores</button>
      </div>
    `;
    feedbackEl.appendChild(banner);
    wireScoreSubmitForm(banner, category, elapsedMs);
  } else {
    const noteEl = document.createElement('div');
    noteEl.className = 'feedback-effect';
    noteEl.textContent = `Partie terminee : ${state.competitive.streak} bonne(s) reponse(s) d'affilee avant l'erreur, en ${formatTime(elapsedMs)}.`;
    feedbackEl.appendChild(noteEl);
  }

  updateHighscoreDisplay();
  retryBtn.classList.remove('hidden');
}

// Branche le formulaire "pseudo + bouton" affiche dans la banniere de victoire
// pour envoyer le score au tableau partage.
function wireScoreSubmitForm(banner, category, timeMs) {
  const pseudoInput = banner.querySelector('#pseudo-input');
  const submitScoreBtn = banner.querySelector('#submit-score-btn');
  const submitContainer = banner.querySelector('.leaderboard-submit');

  submitScoreBtn.addEventListener('click', async () => {
    const pseudo = pseudoInput.value.trim();
    if (!pseudo) {
      pseudoInput.focus();
      return;
    }
    submitScoreBtn.disabled = true;
    submitScoreBtn.textContent = 'Enregistrement...';
    try {
      await submitScoreToLeaderboard(category, pseudo, timeMs);
      submitContainer.innerHTML = '<p class="leaderboard-submitted">Score enregistre !</p>';
    } catch (err) {
      submitScoreBtn.disabled = false;
      submitScoreBtn.textContent = 'Reessayer';
    }
  });
}

// Affiche le classement pour un mode ("Aucun score" / erreur / liste triee).
function renderLeaderboardList(containerEl, scores) {
  if (scores.length === 0) {
    containerEl.innerHTML = '<p class="leaderboard-empty">Aucun score pour l\'instant.</p>';
    return;
  }
  containerEl.innerHTML = scores
    .map(
      (s, i) => `
        <div class="leaderboard-row">
          <span class="leaderboard-rank">#${i + 1}</span>
          <span class="leaderboard-pseudo">${escapeHtml(s.pseudo)}</span>
          <span class="leaderboard-time">${formatTime(s.timeMs)}</span>
        </div>
      `
    )
    .join('');
}

const PODIUM_MEDALS = ['🥇', '🥈', '🥉'];

// Affiche un mini-podium (top 3) pour un mode donne sur l'ecran d'accueil.
// L'ordre visuel est 2e / 1er / 3e, avec des marches de hauteur decroissante
// gerees en CSS via podium-rank-1/2/3.
function renderPodium(containerEl, scores) {
  if (scores.length === 0) {
    containerEl.innerHTML = '<p class="leaderboard-empty">Aucun score pour l\'instant.</p>';
    return;
  }

  const displayOrder = [1, 0, 2];
  containerEl.innerHTML = displayOrder
    .map((i) => {
      const rank = i + 1;
      const s = scores[i];
      const pseudo = s ? escapeHtml(s.pseudo) : '--';
      const time = s ? formatTime(s.timeMs) : '--';
      return `
        <div class="podium-place podium-rank-${rank}${s ? '' : ' podium-empty'}">
          <div class="podium-medal">${PODIUM_MEDALS[i]}</div>
          <div class="podium-pseudo">${pseudo}</div>
          <div class="podium-time">${time}</div>
          <div class="podium-bar"></div>
        </div>
      `;
    })
    .join('');
}

// Charge et affiche une categorie de score independamment des autres : si une
// categorie echoue (ex: regles Firestore pas encore a jour pour une toute
// nouvelle collection), les autres s'affichent quand meme normalement.
async function loadScoreCategory(containerEl, category, limitCount, renderFn) {
  try {
    const scores = await fetchTopScores(category, limitCount);
    renderFn(containerEl, scores);
  } catch (err) {
    containerEl.innerHTML = '<p class="leaderboard-error">Impossible de charger le classement.</p>';
  }
}

async function updateHomePodiums() {
  const loadingHtml = '<p class="leaderboard-empty">Chargement...</p>';
  podiumItemsWithEl.innerHTML = loadingHtml;
  podiumItemsWithoutEl.innerHTML = loadingHtml;
  podiumChampionsEl.innerHTML = loadingHtml;

  await Promise.all([
    loadScoreCategory(podiumItemsWithEl, 'items_with', 3, renderPodium),
    loadScoreCategory(podiumItemsWithoutEl, 'items_without', 3, renderPodium),
    loadScoreCategory(podiumChampionsEl, 'champions', 3, renderPodium),
  ]);
}

async function showLeaderboard() {
  homeScreen.classList.add('hidden');
  itemsSubmenuScreen.classList.add('hidden');
  modeSubmenuScreen.classList.add('hidden');
  quizScreen.classList.add('hidden');
  leaderboardScreen.classList.remove('hidden');

  const loadingHtml = '<p class="leaderboard-empty">Chargement...</p>';
  leaderboardItemsWithEl.innerHTML = loadingHtml;
  leaderboardItemsWithoutEl.innerHTML = loadingHtml;
  leaderboardChampionsEl.innerHTML = loadingHtml;

  await Promise.all([
    loadScoreCategory(leaderboardItemsWithEl, 'items_with', 10, renderLeaderboardList),
    loadScoreCategory(leaderboardItemsWithoutEl, 'items_without', 10, renderLeaderboardList),
    loadScoreCategory(leaderboardChampionsEl, 'champions', 10, renderLeaderboardList),
  ]);
}

// ---------------------------------------------------------------------------
// Navigation entre l'accueil, les sous-menus et les quiz
// ---------------------------------------------------------------------------

// Met a jour le score/nombre de questions affiches en haut du quiz actif
// (mode entrainement uniquement).
function updateScoreBar() {
  const progress = state.scores[state.mode];
  scoreEl.textContent = progress.score;
  questionCountEl.textContent = progress.questionCount;
}

function showHome() {
  state.mode = null;
  updateHomeHighscores();
  updateHomePodiums();
  randomizeHomeCardImages();
  homeScreen.classList.remove('hidden');
  itemsSubmenuScreen.classList.add('hidden');
  modeSubmenuScreen.classList.add('hidden');
  quizScreen.classList.add('hidden');
  leaderboardScreen.classList.add('hidden');
}

// Sous-menu du quiz "objets" : demande d'abord avec ou sans emblemes.
function showItemsSubmenu() {
  randomizeItemsSubmenuImages();
  homeScreen.classList.add('hidden');
  itemsSubmenuScreen.classList.remove('hidden');
  modeSubmenuScreen.classList.add('hidden');
  quizScreen.classList.add('hidden');
}

// Sous-menu du mode de jeu : entrainement ou competitif.
function showModeSubmenu() {
  homeScreen.classList.add('hidden');
  itemsSubmenuScreen.classList.add('hidden');
  modeSubmenuScreen.classList.remove('hidden');
  quizScreen.classList.add('hidden');
}

function chooseItemsFilter(emblemFilter) {
  state.pendingMode = 'items';
  state.itemsEmblemFilter = emblemFilter;
  showModeSubmenu();
}

function chooseChampionsMode() {
  state.pendingMode = 'champions';
  showModeSubmenu();
}

// Lance vraiment le quiz une fois le mode de jeu choisi.
function startQuiz(gameMode) {
  state.mode = state.pendingMode;
  state.gameMode = gameMode;
  modeSubmenuScreen.classList.add('hidden');
  quizScreen.classList.remove('hidden');

  // En competitif, on garde un cadre de taille stable (grille au lieu d'une
  // liste, hauteur minimale) pour pouvoir enchainer les questions vite sans
  // que le bouton Valider/Suivant ne saute de place a chaque question.
  quizCardEl.classList.toggle('competitive-mode', gameMode === 'competitive');

  if (gameMode === 'competitive') {
    scoreBarEl.classList.add('hidden');
    competitiveBarEl.classList.remove('hidden');
    updateHighscoreDisplay();
    startCompetitiveTimer();
  } else {
    scoreBarEl.classList.remove('hidden');
    competitiveBarEl.classList.add('hidden');
    // Le score d'entrainement repart toujours de 0 a chaque nouvelle partie.
    state.scores[state.mode] = { score: 0, questionCount: 0 };
  }

  renderQuestion();
}

// Remet le quiz-card a zero puis delegue au mode actif.
function renderQuestion() {
  state.answered = false;
  feedbackEl.innerHTML = '';
  feedbackEl.className = 'feedback';
  nextBtn.classList.add('hidden');
  submitBtn.classList.add('hidden');
  retryBtn.classList.add('hidden');
  if (state.gameMode === 'training') updateScoreBar();

  if (state.mode === 'items') {
    renderItemQuestion();
  } else {
    renderChampionQuestion();
  }
}

siteTitleEl.addEventListener('click', showHome);

homeItemsBtn.addEventListener('click', showItemsSubmenu);
homeChampionsBtn.addEventListener('click', chooseChampionsMode);
showLeaderboardBtn.addEventListener('click', showLeaderboard);
leaderboardBackBtn.addEventListener('click', showHome);

itemsSubmenuBackBtn.addEventListener('click', showHome);
itemsWithEmblemsBtn.addEventListener('click', () => chooseItemsFilter('with'));
itemsWithoutEmblemsBtn.addEventListener('click', () => chooseItemsFilter('without'));

modeSubmenuBackBtn.addEventListener('click', () => {
  if (state.pendingMode === 'items') {
    showItemsSubmenu();
  } else {
    showHome();
  }
});
modeTrainingBtn.addEventListener('click', () => startQuiz('training'));
modeCompetitiveBtn.addEventListener('click', () => startQuiz('competitive'));

backHomeBtn.addEventListener('click', showModeSubmenu);

nextBtn.addEventListener('click', renderQuestion);
retryBtn.addEventListener('click', () => {
  retryBtn.classList.add('hidden');
  startCompetitiveTimer();
  renderQuestion();
});
submitBtn.addEventListener('click', () => {
  if (state.mode === 'items') {
    handleItemReverseSubmit();
  } else {
    handleChampionSubmit();
  }
});

async function init() {
  await loadData();
  showHome();
}

init();
