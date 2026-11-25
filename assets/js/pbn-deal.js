/* Render inline PBN deals in session notes.

   A fenced code block with the `pbn` language is replaced on load by a diagram:
   four hands around a center panel with the auction. The PBN text stays in the
   Markdown as the source of truth, and remains visible as a plain-text fallback
   when JavaScript is unavailable.

   The diagram is interactive: the toolbar hides the auction or any hand, and
   the deal can be played card by card. Only cards that are legal at that moment
   can be played (turn order and following suit are enforced). Hidden hands play
   a random legal card by themselves, so the play never stalls. Undo takes back
   the last human move together with any automatic cards that followed it. */
(() => {
  'use strict';

  const SUITS = {
    S: { name: 'spades', symbol: '♠', red: false },
    H: { name: 'hearts', symbol: '♥', red: true },
    D: { name: 'diamonds', symbol: '♦', red: true },
    C: { name: 'clubs', symbol: '♣', red: false },
  };
  const SUIT_ORDER = ['S', 'H', 'D', 'C'];
  // A card's rank is a single character everywhere, so the ten is T: in the
  // DOM (`data-card="ST"`), in this table, and in the names read out loud.
  const RANK_ORDER = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
  const RANK_NAMES = {
    A: 'ace',
    K: 'king',
    Q: 'queen',
    J: 'jack',
    T: 'ten',
    9: 'nine',
    8: 'eight',
    7: 'seven',
    6: 'six',
    5: 'five',
    4: 'four',
    3: 'three',
    2: 'two',
  };
  const SEAT_ORDER = ['N', 'E', 'S', 'W'];
  const SEAT_NAMES = { N: 'North', E: 'East', S: 'South', W: 'West' };
  // The auction table always lists the seats in this order, so the cells line
  // up with the hands below; the calls themselves still run clockwise.
  const AUCTION_COLUMNS = ['W', 'N', 'E', 'S'];
  const NEXT_SEAT = { N: 'E', E: 'S', S: 'W', W: 'N' };
  const PARTNER = { N: 'S', S: 'N', E: 'W', W: 'E' };
  // Compass angles for the turn indicator: the needle is drawn pointing up,
  // so North is 0deg and the rest follow clockwise around the table.
  const TURN_ANGLE = { N: 0, E: 90, S: 180, W: 270 };
  const AUTO_DELAY = 700;

  let diagramCount = 0;

  // Session pages carry the session number on the article, so the deal events
  // can say which session's diagram was used. A page without one (a preview,
  // say) simply omits the parameter.
  const sessionArticle = document.querySelector('[data-session-id]');
  const sessionId = sessionArticle ? sessionArticle.dataset.sessionId : null;

  const trackDeal = (name, params) => {
    const data = { ...params };
    if (sessionId) data.session = sessionId;
    window.clubTrack?.(name, data);
  };

  const escapeHtml = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character],
    );

  const seatFrom = (value) => {
    const seat = String(value || '')
      .trim()
      .toUpperCase()
      .charAt(0);
    return SEAT_ORDER.includes(seat) ? seat : null;
  };

  const sideOf = (seat) => (seat === 'N' || seat === 'S' ? 'NS' : 'EW');

  const rankValue = (rank) => {
    const index = RANK_ORDER.indexOf(rank);
    return index === -1 ? RANK_ORDER.length : index;
  };

  const cardKey = (card) => `${card.suit}${card.rank}`;

  const cardName = (card) => `${RANK_NAMES[card.rank] || card.rank} of ${SUITS[card.suit].name}`;

  const parseTags = (text) => {
    const tags = {};
    const pattern = /^\[([A-Za-z][\w-]*)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm;
    let match;
    while ((match = pattern.exec(text))) {
      tags[match[1]] = match[2].replace(/\\"/g, '"');
    }
    return tags;
  };

  const parseRanks = (value) => {
    const ranks = String(value)
      .toUpperCase()
      .match(/10|[AKQJT98765432]/g);
    return ranks ? ranks.map((rank) => (rank === '10' ? 'T' : rank)) : [];
  };

  const parseDeal = (value) => {
    if (!value) return null;

    const colon = value.indexOf(':');
    if (colon === -1) return null;

    const first = seatFrom(value.slice(0, colon));
    if (!first) return null;

    const hands = value
      .slice(colon + 1)
      .trim()
      .split(/\s+/);
    if (hands.length !== 4) return null;

    const deal = {};
    for (let index = 0; index < hands.length; index += 1) {
      const seat = SEAT_ORDER[(SEAT_ORDER.indexOf(first) + index) % 4];
      const suits = hands[index].split('.');
      if (suits.length !== 4) return null;

      deal[seat] = {};
      SUIT_ORDER.forEach((suit, suitIndex) => {
        deal[seat][suit] = parseRanks(suits[suitIndex]);
      });
    }
    return deal;
  };

  const parseAuction = (text) => {
    const match = /^\[Auction\s+"([^"]*)"\]\s*$/m.exec(text);
    if (!match) return { start: null, tokens: [] };

    const rest = text.slice(match.index + match[0].length);
    const nextTag = rest.search(/^\s*\[[A-Za-z]/m);
    const auctionText = nextTag === -1 ? rest : rest.slice(0, nextTag);
    return {
      start: seatFrom(match[1]),
      tokens: auctionText.match(/\S+/g) || [],
    };
  };

  const normalizeBid = (token) =>
    String(token)
      .replace(/[^0-9A-Za-z]/g, '')
      .toUpperCase();

  const isPass = (bid) => bid === 'PASS' || bid === 'P' || bid === 'AP';

  const formatBid = (token) => {
    const bid = normalizeBid(token);
    if (isPass(bid)) return bid === 'AP' ? 'All pass' : 'Pass';
    if (bid === 'X') return 'Dbl';
    if (bid === 'XX') return 'Redbl';

    const match = bid.match(/^([1-7])(NT|[SHDC])$/);
    if (!match) return escapeHtml(bid);

    const [, level, denomination] = match;
    if (denomination === 'NT') return `${level}NT`;

    const suit = SUITS[denomination];
    return `${level}<span class="suit ${suit.red ? 'suit--red' : 'suit--black'}" aria-hidden="true">${suit.symbol}</span><span class="visually-hidden">${suit.name}</span>`;
  };

  const bidLabel = (token) => {
    const bid = normalizeBid(token);
    if (isPass(bid)) return bid === 'AP' ? 'all pass' : 'pass';
    if (bid === 'X') return 'double';
    if (bid === 'XX') return 'redouble';

    const match = bid.match(/^([1-7])(NT|[SHDC])$/);
    if (!match) return bid;

    const [, level, denomination] = match;
    return denomination === 'NT' ? `${level} no-trump` : `${level} ${SUITS[denomination].name}`;
  };

  const deriveContract = (tokens, startSeat) => {
    const startIndex = SEAT_ORDER.indexOf(startSeat);
    const bids = [];

    tokens.forEach((token, index) => {
      const bid = normalizeBid(token);
      if (isPass(bid) || bid === 'X' || bid === 'XX') return;
      bids.push({
        bid,
        seat: SEAT_ORDER[(startIndex + index) % 4],
      });
    });

    if (!bids.length) return null;

    const final = bids[bids.length - 1];
    const denomination = final.bid.replace(/^[1-7]/, '');
    const first = bids.find(
      (entry) =>
        sideOf(entry.seat) === sideOf(final.seat) &&
        entry.bid.replace(/^[1-7]/, '') === denomination,
    );

    return {
      contract: final.bid,
      declarer: first ? first.seat : final.seat,
    };
  };

  const findFit = (deal, declarer) => {
    if (!deal || !declarer) return null;
    const side = [declarer, PARTNER[declarer]];
    let best = null;

    SUIT_ORDER.forEach((suit) => {
      const count = side.reduce(
        (total, seat) => total + (deal[seat] ? deal[seat][suit].length : 0),
        0,
      );
      if (!best || count > best.count) best = { suit, count };
    });

    return best && best.count >= 8 ? best.suit : null;
  };

  const cardChips = (card) => {
    const chip = document.createElement('span');
    chip.className = `card-chip${SUITS[card.suit].red ? ' card-chip--red' : ''}`;
    chip.setAttribute('aria-hidden', 'true');

    const symbol = document.createElement('span');
    symbol.className = 'suit';
    symbol.textContent = SUITS[card.suit].symbol;

    const rank = document.createElement('span');
    rank.className = 'card-chip__rank';
    rank.textContent = card.rank;

    chip.append(symbol, rank);
    return chip;
  };

  const createSeat = (seat, options) => {
    const box = document.createElement('div');
    box.className = `deal-seat deal-seat--${SEAT_NAMES[seat].toLowerCase()}`;
    if (seat === options.dealer) box.classList.add('deal-seat--dealer');
    if (seat === options.leader) box.classList.add('deal-seat--leader');

    const head = document.createElement('div');
    head.className = 'deal-seat__head';

    const letter = document.createElement('span');
    letter.className = 'deal-seat__letter';
    letter.textContent = seat;

    const name = document.createElement('span');
    name.className = 'deal-seat__name';
    name.textContent = SEAT_NAMES[seat];

    head.append(letter, name);

    const body = document.createElement('div');
    body.className = 'deal-seat__body';

    box.append(head, body);
    return { box, body };
  };

  const createAuction = (options) => {
    const panel = document.createElement('div');
    panel.className = 'pbn-deal__auction';

    if (options.tokens.length) {
      const table = document.createElement('table');
      table.className = 'pbn-deal__auction-table';

      const caption = document.createElement('caption');
      caption.className = 'visually-hidden';
      caption.textContent = `Auction, dealer ${SEAT_NAMES[options.dealer]}`;

      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      AUCTION_COLUMNS.forEach((seat) => {
        const cell = document.createElement('th');
        cell.scope = 'col';
        cell.textContent = seat;
        headRow.append(cell);
      });
      thead.append(headRow);

      const tbody = document.createElement('tbody');
      // Read the table the way the auction happened: left to right, top to
      // bottom. The dealer's first call opens the first row partway along it,
      // and the auction wraps onto the next row after South's cell, so a dealer
      // other than West leaves the cells before them blank rather than pushing
      // West's call to the front of the row.
      const rows = [];
      let rowIndex = 0;
      let column = Math.max(0, AUCTION_COLUMNS.indexOf(options.auctionStart));

      options.tokens.forEach((token) => {
        rows[rowIndex] = rows[rowIndex] || {};
        rows[rowIndex][AUCTION_COLUMNS[column]] = token;
        column += 1;
        if (column === AUCTION_COLUMNS.length) {
          column = 0;
          rowIndex += 1;
        }
      });

      rows.forEach((row) => {
        const tr = document.createElement('tr');
        AUCTION_COLUMNS.forEach((seat) => {
          const cell = document.createElement('td');
          cell.innerHTML = row[seat] ? formatBid(row[seat]) : '';
          tr.append(cell);
        });
        tbody.append(tr);
      });

      table.append(caption, thead, tbody);
      panel.append(table);
    }

    if (options.contract && options.declarer) {
      const result = document.createElement('p');
      result.className = 'pbn-deal__result';
      result.innerHTML = `<strong>${formatBid(options.contract)}</strong> by ${SEAT_NAMES[options.declarer]}`;
      panel.append(result);
    }

    if (options.leader) {
      const lead = document.createElement('p');
      lead.className = 'pbn-deal__lead';
      lead.textContent = `Opening lead: ${SEAT_NAMES[options.leader]}`;
      panel.append(lead);
    }

    return panel;
  };

  const createTrickPanel = () => {
    const panel = document.createElement('div');
    panel.className = 'pbn-deal__trick';
    panel.hidden = true;

    const title = document.createElement('p');
    title.className = 'pbn-deal__trick-title';

    const table = document.createElement('div');
    table.className = 'trick-table';

    const slots = {};
    ['N', 'W', 'E', 'S'].forEach((seat) => {
      const slot = document.createElement('div');
      slot.className = `trick-slot trick-slot--${SEAT_NAMES[seat].toLowerCase()}`;
      slots[seat] = slot;
      table.append(slot);
    });

    // A compass in the middle of the table. Its needle turns to the seat that
    // plays next and the letter names that seat, so the center always answers
    // "whose turn is it?" even when the trick itself is empty.
    const turn = document.createElement('div');
    turn.className = 'pbn-deal__turn';
    turn.setAttribute('aria-hidden', 'true');

    const needle = document.createElement('span');
    needle.className = 'pbn-deal__turn-needle';

    const turnSeat = document.createElement('span');
    turnSeat.className = 'pbn-deal__turn-seat';

    turn.append(needle, turnSeat);

    const center = document.createElement('div');
    center.className = 'trick-slot trick-slot--center';
    center.append(turn);
    table.append(center);

    panel.append(title, table);
    return { panel, title, slots, turn, turnSeat };
  };

  const createButton = (label, title, className) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    if (title) button.title = title;
    return button;
  };

  const mount = (source) => {
    const tags = parseTags(source);
    const deal = parseDeal(tags.Deal);
    if (!deal) return null;

    const auction = parseAuction(source);
    const dealer = seatFrom(tags.Dealer) || auction.start || 'N';
    const derived = deriveContract(auction.tokens, auction.start || dealer);

    const contract = normalizeBid(tags.Contract) || (derived && derived.contract) || null;
    const declarer = seatFrom(tags.Declarer) || (derived && derived.declarer) || null;
    const leader = declarer ? NEXT_SEAT[declarer] : null;

    const fit = findFit(deal, declarer);
    const fitSide = declarer ? [declarer, PARTNER[declarer]] : [];

    const contractMatch = contract
      ? /^([1-7])(NT|[SHDC])/.exec(contract.replace(/\s+/g, ''))
      : null;
    const playable = Boolean(contractMatch && declarer && leader);
    const trump = playable && contractMatch[2] !== 'NT' ? contractMatch[2] : null;

    diagramCount += 1;
    const statusId = `pbn-deal-status-${diagramCount}`;

    const root = document.createElement('div');
    root.className = 'pbn-deal';

    const label = [];
    if (tags.Board) label.push(`Deal ${tags.Board}`);
    label.push(`Dealer ${SEAT_NAMES[dealer]}`);
    if (contract && declarer) {
      label.push(`${bidLabel(contract)} by ${SEAT_NAMES[declarer]}`);
    }
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', `${label.join(', ')}.`);

    /* ---- toolbar ------------------------------------------------------- */

    const toolbar = document.createElement('div');
    toolbar.className = 'pbn-deal__toolbar';

    const showControls = document.createElement('div');
    showControls.className = 'deal-controls';
    showControls.setAttribute('role', 'group');
    showControls.setAttribute('aria-label', 'Show or hide parts of the deal');

    const showLabel = document.createElement('span');
    showLabel.className = 'deal-controls__label';
    showLabel.textContent = 'Show/Hide';
    showControls.append(showLabel);

    const shown = { auction: true, N: true, E: true, S: true, W: true };
    const toggles = {};

    const makeToggle = (key, text, title) => {
      const button = createButton(text, title, 'deal-toggle');
      button.setAttribute('aria-pressed', 'true');
      toggles[key] = button;
      showControls.append(button);
      return button;
    };

    const biddingToggle = makeToggle('auction', 'Bidding', 'Show or hide the auction');
    biddingToggle.setAttribute('aria-label', 'Show or hide the auction');
    biddingToggle.addEventListener('click', () => {
      shown.auction = !shown.auction;
      trackDeal('deal_control', { control: 'show_hide', control_target: 'auction' });
      refresh();
    });

    const nsToggle = makeToggle('NS', 'N–S', 'Show or hide both North and South hands');
    nsToggle.setAttribute('aria-label', 'Show or hide both the North and South hands');
    nsToggle.addEventListener('click', () => {
      const next = !(shown.N && shown.S);
      shown.N = next;
      shown.S = next;
      trackDeal('deal_control', { control: 'show_hide', control_target: 'ns' });
      refresh();
    });

    const ewToggle = makeToggle('EW', 'E–W', 'Show or hide both East and West hands');
    ewToggle.setAttribute('aria-label', 'Show or hide both the East and West hands');
    ewToggle.addEventListener('click', () => {
      const next = !(shown.E && shown.W);
      shown.E = next;
      shown.W = next;
      trackDeal('deal_control', { control: 'show_hide', control_target: 'ew' });
      refresh();
    });

    ['N', 'E', 'S', 'W'].forEach((seat) => {
      const button = makeToggle(seat, seat, `Show or hide the ${SEAT_NAMES[seat]} hand`);
      button.setAttribute('aria-label', `Show or hide the ${SEAT_NAMES[seat]} hand`);
      button.addEventListener('click', () => {
        shown[seat] = !shown[seat];
        trackDeal('deal_control', { control: 'show_hide', control_target: seat.toLowerCase() });
        refresh();
      });
    });

    const playControls = document.createElement('div');
    playControls.className = 'deal-controls deal-controls--play';
    playControls.setAttribute('role', 'group');
    playControls.setAttribute('aria-label', 'Play the deal');

    const startButton = createButton('Play deal', 'Start playing this deal', 'deal-action');
    startButton.disabled = !playable;
    if (!playable) {
      startButton.title = 'This deal needs a contract and a declarer to be playable';
    }

    const undoButton = createButton('Undo', 'Take back the last card played', 'deal-action');
    undoButton.disabled = true;

    const restartButton = createButton(
      'Restart',
      'Put every card back and start again',
      'deal-action',
    );
    restartButton.hidden = true;
    restartButton.disabled = !playable;

    playControls.append(startButton, undoButton, restartButton);
    toolbar.append(showControls, playControls);

    const status = document.createElement('p');
    status.className = 'pbn-deal__status';
    status.id = statusId;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    /* ---- center panel -------------------------------------------------- */

    const centerPanel = document.createElement('div');
    centerPanel.className = 'pbn-deal__center';

    const auctionPanel = createAuction({
      tokens: auction.tokens,
      auctionStart: auction.start || dealer,
      dealer,
      contract,
      declarer,
      leader,
    });

    const trick = createTrickPanel();
    centerPanel.append(auctionPanel, trick.panel);

    /* ---- won tricks ---------------------------------------------------- */

    const tricksPanel = document.createElement('ol');
    tricksPanel.className = 'pbn-deal__tricks';
    tricksPanel.hidden = true;
    tricksPanel.setAttribute('aria-label', 'Collected tricks, in the order they were won');

    /* ---- seats --------------------------------------------------------- */

    const seats = {};
    SEAT_ORDER.forEach((seat) => {
      seats[seat] = createSeat(seat, { dealer, leader });
      seats[seat].box.setAttribute('role', 'group');
      seats[seat].box.setAttribute('aria-label', `${SEAT_NAMES[seat]} hand`);
    });

    root.append(
      toolbar,
      status,
      seats.N.box,
      seats.W.box,
      centerPanel,
      seats.E.box,
      seats.S.box,
      tricksPanel,
    );

    /* ---- play state ---------------------------------------------------- */

    const startingHands = {};
    SEAT_ORDER.forEach((seat) => {
      startingHands[seat] = SUIT_ORDER.flatMap((suit) =>
        deal[seat][suit].map((rank) => ({ suit, rank })),
      );
    });
    // Every trick takes one card from each hand, so the deal lasts this long.
    const TRICK_COUNT = startingHands.N.length;

    const copyHands = (hands) => {
      const copy = {};
      SEAT_ORDER.forEach((seat) => {
        copy[seat] = hands[seat].slice();
      });
      return copy;
    };

    const freshState = () => ({
      hands: copyHands(startingHands),
      trick: [],
      pending: null,
      tricks: [],
      turn: leader,
      started: false,
      finished: false,
    });

    let state = freshState();
    let history = [];
    let autoTimer = null;
    let turnAngle = leader ? TURN_ANGLE[leader] : 0;
    trick.turn.style.setProperty('--turn-angle', `${turnAngle}deg`);

    const snapshot = () => ({
      hands: copyHands(state.hands),
      trick: state.trick.slice(),
      pending: state.pending,
      tricks: state.tricks.slice(),
      turn: state.turn,
      started: state.started,
      finished: state.finished,
    });

    const restore = (saved) => {
      state = {
        hands: copyHands(saved.hands),
        trick: saved.trick.slice(),
        pending: saved.pending,
        tricks: saved.tricks.slice(),
        turn: saved.turn,
        started: saved.started,
        finished: saved.finished,
      };
    };

    const handOf = (seat) => state.hands[seat] || [];

    const legalCards = (seat) => {
      const hand = handOf(seat);
      if (!state.trick.length) return hand.slice();
      const led = state.trick[0].card.suit;
      const following = hand.filter((card) => card.suit === led);
      return following.length ? following : hand.slice();
    };

    const trickWinner = (cards) => {
      const led = cards[0].card.suit;
      let pool = cards.filter((entry) => entry.card.suit === led);
      if (trump) {
        const trumps = cards.filter((entry) => entry.card.suit === trump);
        if (trumps.length) pool = trumps;
      }
      return pool.reduce((best, entry) =>
        rankValue(entry.card.rank) < rankValue(best.card.rank) ? entry : best,
      ).seat;
    };

    const allEmpty = () => SEAT_ORDER.every((seat) => handOf(seat).length === 0);

    const trickDescription = (entry) =>
      `Trick ${entry.number}: ${entry.cards
        .map((played) => `${SEAT_NAMES[played.seat]} ${cardName(played.card)}`)
        .join(', ')}. Won by ${SEAT_NAMES[entry.winner]}.`;

    /* ---- rendering ----------------------------------------------------- */

    const renderHands = (focusKey) => {
      SEAT_ORDER.forEach((seat) => {
        const { box, body } = seats[seat];
        box.classList.toggle('deal-seat--hidden', !shown[seat]);
        box.classList.toggle(
          'deal-seat--turn',
          state.started && !state.finished && state.turn === seat,
        );
        body.replaceChildren();

        if (!shown[seat]) {
          const hidden = document.createElement('p');
          hidden.className = 'deal-seat__hidden';

          const text = document.createElement('span');
          text.textContent = 'Hidden';

          const reveal = createButton(
            'Show',
            `Show the ${SEAT_NAMES[seat]} hand`,
            'deal-seat__reveal',
          );
          reveal.addEventListener('click', () => {
            shown[seat] = true;
            refresh();
          });

          hidden.append(text, reveal);
          body.append(hidden);
          return;
        }

        const playableHere = state.started && !state.finished && state.turn === seat;
        const legal = playableHere ? legalCards(seat) : [];
        const hand = handOf(seat);

        if (state.started && !hand.length) {
          const empty = document.createElement('p');
          empty.className = 'deal-seat__empty';
          empty.textContent = 'No cards left';
          body.append(empty);
          return;
        }

        SUIT_ORDER.forEach((suitKey) => {
          const suit = SUITS[suitKey];
          const cards = hand.filter((card) => card.suit === suitKey);

          const row = document.createElement('div');
          row.className = 'deal-seat__suit';
          if (fit === suitKey && fitSide.includes(seat)) {
            row.classList.add('deal-seat__suit--fit');
          }

          const symbol = document.createElement('span');
          symbol.className = `suit ${suit.red ? 'suit--red' : 'suit--black'}`;
          symbol.setAttribute('aria-hidden', 'true');
          symbol.textContent = suit.symbol;

          const label = document.createElement('span');
          label.className = 'visually-hidden';
          label.textContent = `${suit.name}: `;

          const cardBox = document.createElement('span');
          cardBox.className = 'deal-seat__cards';

          if (!cards.length) {
            const dash = document.createElement('span');
            dash.className = 'deal-seat__dash';
            dash.setAttribute('aria-hidden', 'true');
            dash.textContent = '—';
            cardBox.append(dash);
          }

          cards.forEach((card) => {
            const isLegal = state.started && !state.finished && legal.includes(card);
            let element;

            if (!state.started) {
              element = document.createElement('span');
              element.className = `deal-card${suit.red ? ' deal-card--red' : ''}`;
              element.textContent = card.rank;
            } else {
              element = document.createElement('button');
              element.type = 'button';
              element.className = `deal-card deal-card--button${suit.red ? ' deal-card--red' : ''}`;
              element.textContent = card.rank;
              element.disabled = !isLegal;
              if (isLegal) element.classList.add('is-playable');
              element.setAttribute('aria-label', cardName(card));
              element.title = isLegal
                ? `Play the ${cardName(card)}`
                : `The ${cardName(card)} cannot be played now`;
            }

            element.dataset.card = cardKey(card);
            element.dataset.seat = seat;
            cardBox.append(element);
          });

          row.append(symbol, label, cardBox);
          body.append(row);
        });
      });

      if (focusKey) {
        const same = root.querySelector(`[data-card="${focusKey}"]`);
        if (same instanceof HTMLButtonElement && !same.disabled) {
          same.focus();
          return;
        }
        const first = root.querySelector('.deal-card.is-playable');
        if (first) first.focus();
      }
    };

    const clearTrickSlots = () => {
      ['N', 'W', 'E', 'S'].forEach((seat) => {
        trick.slots[seat].replaceChildren();
        trick.slots[seat].classList.remove('trick-slot--winner');
        trick.slots[seat].removeAttribute('aria-label');
      });
    };

    const renderTrick = () => {
      const pending = state.trick.length === 0 ? state.pending : null;
      const cards = state.trick.length ? state.trick : pending ? pending.cards : [];
      // The table stays on screen for the whole of the play, even when it is
      // empty between tricks: the turn compass lives in its middle.
      const showing = state.started && (!state.finished || Boolean(pending));

      if (!showing) {
        trick.panel.hidden = true;
        clearTrickSlots();
        return;
      }

      trick.panel.hidden = false;
      trick.panel.classList.toggle('pbn-deal__trick--complete', Boolean(pending));
      trick.panel.classList.toggle('pbn-deal__trick--collectable', Boolean(pending));

      const number = pending ? pending.number : state.tricks.length + 1;
      const winner = pending ? pending.winner : null;

      if (pending) {
        trick.title.textContent = `${SEAT_NAMES[winner]} won trick ${number}`;
        trick.panel.title = 'Click to collect this trick';
        trick.panel.setAttribute('role', 'button');
        trick.panel.setAttribute('tabindex', '0');
        trick.panel.setAttribute(
          'aria-label',
          `Trick ${number} won by ${SEAT_NAMES[winner]}. Press to collect it.`,
        );
      } else {
        trick.title.textContent = `Trick ${number} of ${TRICK_COUNT}`;
        trick.panel.removeAttribute('title');
        trick.panel.removeAttribute('role');
        trick.panel.removeAttribute('tabindex');
        trick.panel.removeAttribute('aria-label');
      }

      ['N', 'W', 'E', 'S'].forEach((seat) => {
        const slot = trick.slots[seat];
        slot.replaceChildren();
        slot.classList.remove('trick-slot--winner');
        slot.removeAttribute('aria-label');

        const played = cards.find((entry) => entry.seat === seat);
        if (!played) return;

        if (pending && seat === winner) slot.classList.add('trick-slot--winner');
        slot.append(cardChips(played.card));
        slot.setAttribute('aria-label', `${SEAT_NAMES[seat]} played the ${cardName(played.card)}`);
      });
    };

    const renderTricks = () => {
      if (!state.started || !state.tricks.length) {
        tricksPanel.hidden = true;
        tricksPanel.replaceChildren();
        return;
      }

      tricksPanel.hidden = false;
      tricksPanel.replaceChildren();

      state.tricks.forEach((entry) => {
        const pile = document.createElement('li');
        pile.className = `trick-pile trick-pile--${entry.side.toLowerCase()}`;
        pile.title = trickDescription(entry);
        pile.setAttribute('aria-label', trickDescription(entry));
        tricksPanel.append(pile);
      });
    };

    // Where should the needle point? On a wide screen the hands sit around the
    // table, so North is up and the compass angles are literally true. On a
    // narrow screen the hands stack in a column, and a needle pointing right
    // for East would point at nothing. Aim at the nearest edge of the active
    // hand's box instead, and fall back to the compass when it is hidden.
    const angleToward = (seat) => {
      const target = seats[seat].box.getBoundingClientRect();
      const origin = trick.turn.getBoundingClientRect();
      if (target.width + target.height === 0) return TURN_ANGLE[seat];

      const cx = origin.left + origin.width / 2;
      const cy = origin.top + origin.height / 2;
      const nearestX = Math.min(Math.max(cx, target.left), target.right);
      const nearestY = Math.min(Math.max(cy, target.top), target.bottom);
      const dx = nearestX - cx;
      const dy = nearestY - cy;
      // The badge sits outside every hand, so this only guards a degenerate box.
      if (!dx && !dy) return TURN_ANGLE[seat];

      // 0deg is up and angles grow clockwise, matching the CSS rotation.
      return (Math.atan2(dx, -dy) * 180) / Math.PI;
    };

    const renderTurn = () => {
      const active = state.started && !state.finished;
      trick.turn.hidden = !active;
      if (!active) return;

      // Turn the short way, which is also the clockwise way from seat to seat,
      // so the needle never spins all the way around at North.
      const target = angleToward(state.turn);
      let delta = target - (turnAngle % 360);
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      if (delta) {
        turnAngle += delta;
        trick.turn.style.setProperty('--turn-angle', `${turnAngle}deg`);
      }
      trick.turnSeat.textContent = state.turn;
    };

    const renderStatus = () => {
      if (!state.started) {
        status.textContent = playable
          ? 'Play the deal card by card. Only legal cards can be played.'
          : 'This deal cannot be played because it has no contract.';
        return;
      }

      if (state.finished) {
        const ns =
          state.tricks.filter((entry) => entry.side === 'NS').length +
          (state.pending && state.pending.side === 'NS' ? 1 : 0);
        const ew =
          state.tricks.filter((entry) => entry.side === 'EW').length +
          (state.pending && state.pending.side === 'EW' ? 1 : 0);
        const hand = state.pending ? ' Click the last trick to collect it.' : '';
        status.textContent = `Play finished. N–S won ${ns} ${ns === 1 ? 'trick' : 'tricks'}, E–W won ${ew}.${hand}`;
        return;
      }

      const name = SEAT_NAMES[state.turn];
      if (!state.trick.length) {
        status.textContent = `${name} to lead.`;
        return;
      }

      const led = state.trick[0].card.suit;
      const mustFollow = legalCards(state.turn).every((card) => card.suit === led);
      const hint =
        mustFollow && legalCards(state.turn).length < handOf(state.turn).length
          ? ` ${name} must follow ${SUITS[led].name}.`
          : '';
      status.textContent = `${name} to play.${hint}`;
    };

    const renderControls = () => {
      startButton.hidden = state.started || !playable;
      restartButton.hidden = !state.started;
      undoButton.disabled = history.length === 0;
      auctionPanel.hidden = !shown.auction;

      toggles.auction.setAttribute('aria-pressed', String(shown.auction));
      toggles.N.setAttribute('aria-pressed', String(shown.N));
      toggles.E.setAttribute('aria-pressed', String(shown.E));
      toggles.S.setAttribute('aria-pressed', String(shown.S));
      toggles.W.setAttribute('aria-pressed', String(shown.W));

      const pair = (key, first, second) => {
        const both = shown[first] && shown[second];
        const neither = !shown[first] && !shown[second];
        toggles[key].setAttribute('aria-pressed', both ? 'true' : neither ? 'false' : 'mixed');
      };
      pair('NS', 'N', 'S');
      pair('EW', 'E', 'W');
    };

    const refresh = () => {
      const active = document.activeElement;
      const focusKey =
        active && root.contains(active) && active.dataset ? active.dataset.card || null : null;

      renderHands(focusKey);
      renderTrick();
      renderTricks();
      // Panels change the layout the needle is measured against, so settle
      // them before aiming it.
      renderStatus();
      renderControls();
      renderTurn();
      scheduleAuto();
    };

    /* ---- play ---------------------------------------------------------- */

    const clearAuto = () => {
      if (autoTimer !== null) {
        clearTimeout(autoTimer);
        autoTimer = null;
      }
    };

    const collect = () => {
      if (!state.pending) return false;
      state.tricks.push(state.pending);
      state.pending = null;
      return true;
    };

    const play = (seat, card, auto) => {
      if (!state.started || state.finished) return false;
      if (seat !== state.turn) return false;
      if (!legalCards(seat).includes(card)) return false;

      // Leading a card is one of the two ways to send a finished trick down to
      // the pile, so collect it before the snapshot: undo should bring the card
      // back, not resurrect a trick the player has already put away.
      collect();

      history.push({ saved: snapshot(), auto: Boolean(auto) });

      state.hands[seat] = handOf(seat).filter((entry) => entry !== card);
      state.trick.push({ seat, card });
      state.turn = NEXT_SEAT[seat];

      if (state.trick.length === 4) {
        const winner = trickWinner(state.trick);
        state.pending = {
          number: state.tricks.length + 1,
          cards: state.trick.slice(),
          winner,
          side: sideOf(winner),
        };
        state.trick = [];
        state.turn = winner;
        if (allEmpty()) state.finished = true;
      }

      refresh();
      return true;
    };

    const scheduleAuto = () => {
      clearAuto();
      if (!state.started || state.finished || !playable) return;
      if (shown[state.turn]) return;

      autoTimer = setTimeout(() => {
        autoTimer = null;
        if (!state.started || state.finished || shown[state.turn]) return;
        const options = legalCards(state.turn);
        if (!options.length) return;
        play(state.turn, options[Math.floor(Math.random() * options.length)], true);
      }, AUTO_DELAY);
    };

    const startPlay = () => {
      clearAuto();
      state = freshState();
      state.started = true;
      history = [];
      shown.auction = false;
      trackDeal('deal_play');
      refresh();
    };

    const undo = () => {
      clearAuto();
      if (!history.length) return;

      let target = null;
      while (history.length) {
        const entry = history.pop();
        target = entry.saved;
        if (!entry.auto) break;
      }

      if (target) restore(target);
      trackDeal('deal_control', { control: 'undo' });
      refresh();
    };

    const restart = () => {
      clearAuto();
      state = freshState();
      state.started = true;
      history = [];
      trackDeal('deal_control', { control: 'restart' });
      refresh();
    };

    const collectAndContinue = () => {
      trackDeal('deal_control', { control: 'collect_trick' });
      collect();
      refresh();
      // Keep keyboard and screen-reader focus on the hand that has to play
      // next instead of dropping it to the page. When that hand is hidden the
      // deal plays itself, so offer the button that reveals it.
      const next = root.querySelector('.deal-card.is-playable');
      if (next) {
        next.focus();
        return;
      }
      const reveal = root.querySelector('.deal-seat--turn .deal-seat__reveal');
      if (reveal) reveal.focus();
    };

    startButton.addEventListener('click', startPlay);
    undoButton.addEventListener('click', undo);
    restartButton.addEventListener('click', restart);
    // The needle aims at the hand on screen, so a reflow that moves the hands
    // (a resize, a zoom, or a toolbar toggle) has to re-aim it.
    window.addEventListener('resize', renderTurn);

    root.addEventListener('click', (event) => {
      const trickPanel = event.target.closest('.pbn-deal__trick');
      if (trickPanel && state.pending) {
        collectAndContinue();
        return;
      }

      const button = event.target.closest('button.deal-card');
      if (!button) return;
      const seat = button.dataset.seat;
      const key = button.dataset.card;
      const card = handOf(seat).find((entry) => cardKey(entry) === key);
      if (card) play(seat, card, false);
    });

    trick.panel.addEventListener('keydown', (event) => {
      if (!state.pending) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      collectAndContinue();
    });

    refresh();
    return root;
  };

  const codeBlocks = document.querySelectorAll('pre > code.language-pbn');
  codeBlocks.forEach((code) => {
    const diagram = mount(code.textContent);
    if (!diagram) return;

    const pre = code.closest('pre');
    const target = pre.closest('.highlighter-rouge') || pre;
    target.replaceWith(diagram);
  });
})();
