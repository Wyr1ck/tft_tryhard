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
  answered: false,         // empeche de valider 2 fois la meme question
  scores: {
    // Score du mode entrainement : reinitialise a chaque lancement de partie.
    items: { score: 0, questionCount: 0 },
    champions: { score: 0, questionCount: 0 },
  },
  competitive: {
    streak: 0,
    startTime: null,
    intervalId: null,
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
const leaderboardItemsEl = document.getElementById('leaderboard-items');
const leaderboardChampionsEl = document.getElementById('leaderboard-champions');

const podiumItemsEl = document.getElementById('podium-items');
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

// Chaque mode a sa propre collection ("tiroir") plutot qu'une seule collection
// filtree par mode : ca evite d'avoir a creer un index compose dans Firestore.
function getScoresCollectionName(mode) {
  return mode === 'items' ? 'scores_items' : 'scores_champions';
}

async function submitScoreToLeaderboard(mode, pseudo, timeMs) {
  await db.collection(getScoresCollectionName(mode)).add({
    pseudo: pseudo.trim().slice(0, 20),
    timeMs,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

async function fetchTopScores(mode, limitCount = 10) {
  const snapshot = await db
    .collection(getScoresCollectionName(mode))
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

// Tres peu de personnages ont deja un visuel (contrairement aux objets, ou la
// plupart en ont). On garde une liste courte de ceux qui existent vraiment
// pour la carte d'accueil, plutot que de tenter tous les personnages et
// enchainer des dizaines de 404 avant d'en trouver un valide.
const CHAMPION_IDS_WITH_IMAGE = ['alune', 'dragon_ancestral', 'kobuko', 'krug'];

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
  const championsWithImage = CHAMPION_IDS_WITH_IMAGE.map((id) => ({ id }));
  setRandomCardImage(homeChampionsImgEl, championsWithImage, getChampionImagePath);
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

// Tire un objet au hasard, en evitant de reposer le meme qu'a la question
// precedente (sauf si le pool ne contient qu'un seul objet).
function pickRandomItem() {
  const items = getItemPool();
  const candidates =
    items.length > 1 ? items.filter((item) => item.id !== state.lastItemId) : items;
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  state.lastItemId = picked.id;
  return picked;
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

  feedbackEl.innerHTML = `
    <div class="feedback-title">${iconHtml}${titleText}</div>
    <div class="feedback-effect">${question.effectText || 'Effet non renseigne.'}</div>
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
  const wrongEntries = wrongPool.slice(0, neededWrong).map((c) => ({ ...c, isCorrect: false }));

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
  feedbackEl.innerHTML = `
    <div class="feedback-title">${iconHtml}${titleText}</div>
    <div class="feedback-effect">${item.effect || 'Effet non renseigne.'}</div>
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

// Tire un personnage au hasard, en evitant de reposer le meme qu'a la
// question precedente.
function pickRandomChampion() {
  const champions = state.champData.champions;
  const candidates =
    champions.length > 1 ? champions.filter((c) => c.id !== state.lastChampionId) : champions;
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  state.lastChampionId = picked.id;
  return picked;
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
    <span class="chip">
      <img class="chip-icon" src="${getChampionImagePath(champion.id)}" alt="">
      ${champion.name}
      <span class="champion-cost">${champion.cost} <span class="champion-cost-star">★</span></span>
    </span>
  `;
  componentsEl.querySelectorAll('.chip-icon').forEach(hideImageOnError);

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
  // Les bons traits (trouves ou manques) affichent toujours leur definition.
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
      const trait = state.champData.traits.find((t) => t.id === traitId);
      const defEl = document.createElement('span');
      defEl.className = 'trait-def';
      defEl.textContent = trait.definition || 'Definition a venir.';
      option.querySelector('.trait-option-text').appendChild(defEl);
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
  const iconHtml = `<img class="feedback-icon" src="${getChampionImagePath(champion.id)}" alt="" onerror="this.style.display='none'">`;
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

// (Re)demarre la serie competitive : serie a 0, chrono a 0 et lance le
// rafraichissement de l'affichage du temps toutes les 100ms.
function startCompetitiveTimer() {
  stopCompetitiveTimer();
  state.competitive.streak = 0;
  state.competitive.startTime = Date.now();
  streakEl.textContent = '0';
  timerEl.textContent = '00:00.0';
  state.competitive.intervalId = setInterval(() => {
    timerEl.textContent = formatTime(Date.now() - state.competitive.startTime);
  }, 100);
}

function stopCompetitiveTimer() {
  if (state.competitive.intervalId !== null) {
    clearInterval(state.competitive.intervalId);
    state.competitive.intervalId = null;
  }
}

function getHighscoreMs(mode) {
  const raw = localStorage.getItem(`tft_${mode}_highscore_ms`);
  return raw !== null ? parseInt(raw, 10) : null;
}

function updateHighscoreDisplay() {
  const ms = getHighscoreMs(state.mode);
  highscoreEl.textContent = ms !== null ? formatTime(ms) : '--';
}

function updateHomeHighscores() {
  const itemsMs = getHighscoreMs('items');
  const champMs = getHighscoreMs('champions');
  homeItemsHighscoreEl.textContent = itemsMs !== null ? formatTime(itemsMs) : '--';
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

// Arrete le chrono et affiche soit un message de victoire (avec record
// eventuel), soit un message de game over.
function finishCompetitiveRun(won) {
  stopCompetitiveTimer();
  const elapsedMs = Date.now() - state.competitive.startTime;

  if (won) {
    const key = `tft_${state.mode}_highscore_ms`;
    const currentBest = getHighscoreMs(state.mode);
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
    wireScoreSubmitForm(banner, state.mode, elapsedMs);
  } else {
    const noteEl = document.createElement('div');
    noteEl.className = 'feedback-effect';
    noteEl.textContent = `Partie terminee : ${state.competitive.streak} bonne(s) reponse(s) d'affilee avant l'erreur.`;
    feedbackEl.appendChild(noteEl);
  }

  updateHighscoreDisplay();
  retryBtn.classList.remove('hidden');
}

// Branche le formulaire "pseudo + bouton" affiche dans la banniere de victoire
// pour envoyer le score au tableau partage.
function wireScoreSubmitForm(banner, mode, timeMs) {
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
      await submitScoreToLeaderboard(mode, pseudo, timeMs);
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

async function updateHomePodiums() {
  podiumItemsEl.innerHTML = '<p class="leaderboard-empty">Chargement...</p>';
  podiumChampionsEl.innerHTML = '<p class="leaderboard-empty">Chargement...</p>';

  try {
    const [itemsScores, championsScores] = await Promise.all([
      fetchTopScores('items', 3),
      fetchTopScores('champions', 3),
    ]);
    renderPodium(podiumItemsEl, itemsScores);
    renderPodium(podiumChampionsEl, championsScores);
  } catch (err) {
    const errorHtml = '<p class="leaderboard-error">Impossible de charger le classement.</p>';
    podiumItemsEl.innerHTML = errorHtml;
    podiumChampionsEl.innerHTML = errorHtml;
  }
}

async function showLeaderboard() {
  homeScreen.classList.add('hidden');
  itemsSubmenuScreen.classList.add('hidden');
  modeSubmenuScreen.classList.add('hidden');
  quizScreen.classList.add('hidden');
  leaderboardScreen.classList.remove('hidden');

  leaderboardItemsEl.innerHTML = '<p class="leaderboard-empty">Chargement...</p>';
  leaderboardChampionsEl.innerHTML = '<p class="leaderboard-empty">Chargement...</p>';

  try {
    const [itemsScores, championsScores] = await Promise.all([
      fetchTopScores('items'),
      fetchTopScores('champions'),
    ]);
    renderLeaderboardList(leaderboardItemsEl, itemsScores);
    renderLeaderboardList(leaderboardChampionsEl, championsScores);
  } catch (err) {
    const errorHtml = '<p class="leaderboard-error">Impossible de charger le classement.</p>';
    leaderboardItemsEl.innerHTML = errorHtml;
    leaderboardChampionsEl.innerHTML = errorHtml;
  }
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

siteTitleEl.addEventListener('click', () => {
  stopCompetitiveTimer();
  showHome();
});

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

backHomeBtn.addEventListener('click', () => {
  stopCompetitiveTimer();
  showModeSubmenu();
});

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
