/* Render inline PBN deals in session notes.

   A fenced code block with the `pbn` language is replaced on load by a static
   diagram: four hands around the auction. The PBN text stays in the Markdown
   as the source of truth, and remains visible as a plain-text fallback when
   JavaScript is unavailable. Nothing here is interactive. */
(() => {
  'use strict';

  const SUITS = {
    S: { name: 'spades', symbol: '♠', red: false },
    H: { name: 'hearts', symbol: '♥', red: true },
    D: { name: 'diamonds', symbol: '♦', red: true },
    C: { name: 'clubs', symbol: '♣', red: false },
  };
  const SUIT_ORDER = ['S', 'H', 'D', 'C'];
  const SEAT_ORDER = ['N', 'E', 'S', 'W'];
  const SEAT_NAMES = { N: 'North', E: 'East', S: 'South', W: 'West' };
  const NEXT_SEAT = { N: 'E', E: 'S', S: 'W', W: 'N' };
  const PARTNER = { N: 'S', S: 'N', E: 'W', W: 'E' };

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
    return ranks ? ranks.map((rank) => (rank === 'T' ? '10' : rank)) : [];
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

  const createSeat = (seat, hand, options) => {
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
    box.append(head);

    const body = document.createElement('div');
    body.className = 'deal-seat__body';

    SUIT_ORDER.forEach((suitKey) => {
      const suit = SUITS[suitKey];
      const row = document.createElement('div');
      row.className = 'deal-seat__suit';
      if (options.fit === suitKey && options.fitSide.includes(seat)) {
        row.classList.add('deal-seat__suit--fit');
      }

      const symbol = document.createElement('span');
      symbol.className = `suit ${suit.red ? 'suit--red' : 'suit--black'}`;
      symbol.setAttribute('aria-hidden', 'true');
      symbol.textContent = suit.symbol;

      const label = document.createElement('span');
      label.className = 'visually-hidden';
      label.textContent = `${suit.name}: `;

      const cards = document.createElement('span');
      cards.className = 'deal-seat__cards';
      cards.textContent = hand[suitKey].join('') || '—';

      row.append(symbol, label, cards);
      body.append(row);
    });

    box.append(body);
    return box;
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
      ['W', 'N', 'E', 'S'].forEach((seat) => {
        const cell = document.createElement('th');
        cell.scope = 'col';
        cell.textContent = seat;
        headRow.append(cell);
      });
      thead.append(headRow);

      const tbody = document.createElement('tbody');
      const rows = [];
      const startIndex = SEAT_ORDER.indexOf(options.auctionStart);

      options.tokens.forEach((token, index) => {
        const seat = SEAT_ORDER[(startIndex + index) % 4];
        const rowIndex = Math.floor(index / 4);
        rows[rowIndex] = rows[rowIndex] || {};
        rows[rowIndex][seat] = token;
      });

      rows.forEach((row) => {
        const tr = document.createElement('tr');
        ['W', 'N', 'E', 'S'].forEach((seat) => {
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

  const render = (source) => {
    const tags = parseTags(source);
    const deal = parseDeal(tags.Deal);
    if (!deal) return null;

    const auction = parseAuction(source);
    const dealer = seatFrom(tags.Dealer) || auction.start || 'N';
    const derived = deriveContract(auction.tokens, auction.start || dealer);

    const contract = normalizeBid(tags.Contract) || (derived && derived.contract);
    const declarer = seatFrom(tags.Declarer) || (derived && derived.declarer) || null;
    const leader = declarer ? NEXT_SEAT[declarer] : null;

    const fit = findFit(deal, declarer);
    const fitSide = declarer ? [declarer, PARTNER[declarer]] : [];

    const diagram = document.createElement('div');
    diagram.className = 'pbn-deal';

    const label = [];
    if (tags.Board) label.push(`Deal ${tags.Board}`);
    label.push(`Dealer ${SEAT_NAMES[dealer]}`);
    if (contract && declarer) {
      label.push(`${bidLabel(contract)} by ${SEAT_NAMES[declarer]}`);
    }
    diagram.setAttribute('role', 'group');
    diagram.setAttribute('aria-label', `${label.join(', ')}.`);

    SEAT_ORDER.forEach((seat) => {
      diagram.append(
        createSeat(seat, deal[seat], {
          dealer,
          leader,
          fit,
          fitSide,
        }),
      );
    });

    diagram.append(
      createAuction({
        tokens: auction.tokens,
        auctionStart: auction.start || dealer,
        dealer,
        contract,
        declarer,
        leader,
      }),
    );

    return diagram;
  };

  const codeBlocks = document.querySelectorAll('pre > code.language-pbn');
  codeBlocks.forEach((code) => {
    const diagram = render(code.textContent);
    if (!diagram) return;

    const pre = code.closest('pre');
    const target = pre.closest('.highlighter-rouge') || pre;
    target.replaceWith(diagram);
  });
})();
