// "state" regroupe toutes les infos qui changent pendant que le quiz tourne.
// On evite les variables eparpillees partout : tout est ici, au meme endroit.
const state = {
  data: null,             // contenu de items.json une fois charge
  champData: null,        // contenu de champions.json une fois charge
  mode: null,              // null = accueil, sinon 'items' ou 'champions'
  itemQuestionType: null,  // 'forward' (composants -> objet) ou 'reverse' (objet -> composants)
  currentQuestion: null,   // question du mode "items" (forward) affichee en ce moment
  currentReverseItem: null, // objet du mode "items" (reverse) affiche en ce moment
  currentChampion: null,   // personnage du mode "champions" affiche en ce moment
  answered: false,        // empeche de valider 2 fois la meme question
  scores: {
    items: { score: 0, questionCount: 0 },
    champions: { score: 0, questionCount: 0 },
  },
};

// On recupere une bonne fois pour toutes les elements HTML qu'on va manipuler.
const homeScreen = document.getElementById('home-screen');
const quizScreen = document.getElementById('quiz-screen');
const homeItemsBtn = document.getElementById('home-items');
const homeChampionsBtn = document.getElementById('home-champions');
const homeItemsScoreEl = document.getElementById('home-items-score');
const homeItemsCountEl = document.getElementById('home-items-count');
const homeChampionsScoreEl = document.getElementById('home-champions-score');
const homeChampionsCountEl = document.getElementById('home-champions-count');
const backHomeBtn = document.getElementById('back-home-btn');
const resetBtn = document.getElementById('reset-btn');

const scoreEl = document.getElementById('score');
const questionCountEl = document.getElementById('question-count');
const promptEl = document.getElementById('prompt-text');
const componentsEl = document.getElementById('components');
const answersEl = document.getElementById('answers');
const feedbackEl = document.getElementById('feedback');
const nextBtn = document.getElementById('next-btn');
const submitBtn = document.getElementById('submit-btn');

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

// ---------------------------------------------------------------------------
// Mode "Combos d'objets" (QCM a 4 choix, une seule bonne reponse)
// ---------------------------------------------------------------------------

function pickRandomItem() {
  const items = state.data.items;
  return items[Math.floor(Math.random() * items.length)];
}

// Un objet fabrique avec Spatule ou Poele a frire est un embleme (ou un objet
// Tacticien). On s'en sert pour ne jamais melanger ces objets-la avec les
// objets "normaux" dans les choix de reponse.
const EMBLEM_COMPONENT_IDS = ['spatule', 'poele_a_frire'];

function isEmblemFamily(item) {
  return item.components.some((id) => EMBLEM_COMPONENT_IDS.includes(id));
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
  const progress = state.scores.items;
  progress.questionCount++;

  const question = state.currentQuestion;
  const isCorrect = choiceId === question.correctId;
  const titleText = isCorrect ? 'Correct !' : 'Incorrect !';
  const iconHtml = `<img class="feedback-icon" src="${question.feedbackImage}" alt="" onerror="this.style.display='none'">`;

  feedbackEl.innerHTML = `
    <div class="feedback-title">${iconHtml}${titleText}</div>
    <div class="feedback-effect">${question.effectText || 'Effet non renseigne.'}</div>
  `;
  feedbackEl.className = isCorrect ? 'feedback correct' : 'feedback incorrect';

  if (isCorrect) progress.score++;

  // Quoi qu'il arrive, on met en evidence la bonne reponse et on bloque les boutons.
  [...answersEl.children].forEach((btn) => {
    btn.disabled = true;
    if (btn.dataset.choiceId === question.correctId) {
      btn.classList.add('correct');
    } else if (btn === btnEl) {
      btn.classList.add('incorrect');
    }
  });

  updateScoreBar();
  saveProgress();

  nextBtn.classList.remove('hidden');
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
  const progress = state.scores.items;
  progress.questionCount++;

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

  if (isCorrect) progress.score++;

  updateScoreBar();
  saveProgress();

  submitBtn.classList.add('hidden');
  nextBtn.classList.remove('hidden');
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

function pickRandomChampion() {
  const champions = state.champData.champions;
  return champions[Math.floor(Math.random() * champions.length)];
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
  const progress = state.scores.champions;
  progress.questionCount++;

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

  if (isCorrect) progress.score++;

  updateScoreBar();
  saveProgress();

  submitBtn.classList.add('hidden');
  nextBtn.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Navigation entre l'accueil et les quiz
// ---------------------------------------------------------------------------

// Met a jour le score/nombre de questions affiches en haut du quiz actif.
function updateScoreBar() {
  const progress = state.scores[state.mode];
  scoreEl.textContent = progress.score;
  questionCountEl.textContent = progress.questionCount;
}

// Met a jour l'aperçu de score affiche sur les cartes de l'accueil.
function updateHomeCards() {
  homeItemsScoreEl.textContent = state.scores.items.score;
  homeItemsCountEl.textContent = state.scores.items.questionCount;
  homeChampionsScoreEl.textContent = state.scores.champions.score;
  homeChampionsCountEl.textContent = state.scores.champions.questionCount;
}

function showHome() {
  state.mode = null;
  updateHomeCards();
  homeScreen.classList.remove('hidden');
  quizScreen.classList.add('hidden');
}

function enterQuiz(mode) {
  state.mode = mode;
  homeScreen.classList.add('hidden');
  quizScreen.classList.remove('hidden');
  renderQuestion();
}

// Remet a zero le score du quiz actuellement affiche, puis relance une question.
function resetCurrentQuiz() {
  state.scores[state.mode] = { score: 0, questionCount: 0 };
  saveProgress();
  renderQuestion();
}

// Remet le quiz-card a zero puis delegue au mode actif.
function renderQuestion() {
  state.answered = false;
  feedbackEl.innerHTML = '';
  feedbackEl.className = 'feedback';
  nextBtn.classList.add('hidden');
  submitBtn.classList.add('hidden');
  updateScoreBar();

  if (state.mode === 'items') {
    renderItemQuestion();
  } else {
    renderChampionQuestion();
  }
}

// Sauvegarde les scores dans le navigateur (survivent a un rechargement de la page).
function saveProgress() {
  localStorage.setItem('tft_items_score', String(state.scores.items.score));
  localStorage.setItem('tft_items_question_count', String(state.scores.items.questionCount));
  localStorage.setItem('tft_champions_score', String(state.scores.champions.score));
  localStorage.setItem('tft_champions_question_count', String(state.scores.champions.questionCount));
}

function loadProgress() {
  const savedItemsScore = localStorage.getItem('tft_items_score');
  const savedItemsCount = localStorage.getItem('tft_items_question_count');
  const savedChampScore = localStorage.getItem('tft_champions_score');
  const savedChampCount = localStorage.getItem('tft_champions_question_count');

  if (savedItemsScore !== null) state.scores.items.score = parseInt(savedItemsScore, 10);
  if (savedItemsCount !== null) state.scores.items.questionCount = parseInt(savedItemsCount, 10);
  if (savedChampScore !== null) state.scores.champions.score = parseInt(savedChampScore, 10);
  if (savedChampCount !== null) state.scores.champions.questionCount = parseInt(savedChampCount, 10);
}

homeItemsBtn.addEventListener('click', () => enterQuiz('items'));
homeChampionsBtn.addEventListener('click', () => enterQuiz('champions'));
backHomeBtn.addEventListener('click', showHome);
resetBtn.addEventListener('click', resetCurrentQuiz);
nextBtn.addEventListener('click', renderQuestion);
submitBtn.addEventListener('click', () => {
  if (state.mode === 'items') {
    handleItemReverseSubmit();
  } else {
    handleChampionSubmit();
  }
});

async function init() {
  await loadData();
  loadProgress();
  showHome();
}

init();
