#!/usr/bin/env node
// Local PBN sanity checker for the Cobb Bridge Club notes.
//
// bridge-wrangler and the `pbn` npm parser both accept PBN that is
// syntactically fine but wrong as bridge: a hand with twelve cards, a card
// dealt twice, a bid from the wrong seat. This script checks those things.
// It reads a .pbn file (or stdin) and prints one line per problem.
//
// Usage:
//   node pbn/check-pbn.mjs deal.pbn
//   sed -n '/^```pbn$/,/^```$/p' _sessions/2026-11-19.md | sed '1d;$d' \
//     | node pbn/check-pbn.mjs -
//
// Exit status is 0 when every board is clean, 1 otherwise.

import { readFileSync } from 'node:fs';

const SEATS = 'NESW';
const RANKS = 'AKQJT98765432';
const SUITS = 'SHDC';
const VULNERABILITIES = ['None', 'NS', 'EW', 'All', 'Love', 'Both', '-'];

const problems = [];

function report(where, message) {
  problems.push(`${where}: ${message}`);
}

function parseDeal(value, where) {
  // "N:Q4.K54... A65... ..." — hands may each carry a seat letter.
  let seat = SEATS.indexOf(value[0]);
  if (seat < 0 || value[1] !== ':') {
    report(where, `Deal must start with a seat and a colon, found "${value[0] ?? ''}"`);
    return;
  }

  const hands = value.slice(2).trim().split(/\s+/);
  if (hands.length !== 4) {
    report(where, `Deal has ${hands.length} hands, expected 4`);
    return;
  }

  const seen = new Map();
  hands.forEach((hand, index) => {
    let text = hand;
    if (SEATS.includes(text[0]) && !RANKS.includes(text[0])) {
      seat = SEATS.indexOf(text[0]);
      text = text.slice(1);
    }

    const owner = SEATS[seat];
    const suits = text.split('.');
    if (suits.length !== 4) {
      report(where, `${owner} has ${suits.length} suits, expected 4`);
    }

    let count = 0;
    suits.forEach((cards, suitIndex) => {
      for (const rank of cards.match(/10|[AKQJT98765432]/g) ?? []) {
        const normalized = rank === '10' ? 'T' : rank;
        const card = SUITS[suitIndex] + normalized;
        count += 1;
        if (seen.has(card)) {
          report(where, `${card} is dealt to both ${seen.get(card)} and ${owner}`);
        } else {
          seen.set(card, owner);
        }
      }
      const dangling = cards.replace(/10|[AKQJT98765432-]/g, '');
      if (dangling) {
        report(where, `${owner}${SUITS[suitIndex]} has bad characters "${dangling}"`);
      }
    });

    if (text.includes('10')) {
      report(where, `${owner} uses "10" for the ten; standard PBN uses "T"`);
    }

    if (count !== 13) {
      report(where, `${owner} has ${count} cards, expected 13`);
    }

    seat = (seat + 1) % 4;
  });
}

function parseAuction(value, section, where, board) {
  const tokens = [value, ...section].join(' ').split(/\s+/).filter(Boolean).slice(1); // drop the dealer letter

  if (!SEATS.includes(value[0])) {
    report(where, `Auction must start with the dealer, found "${value[0]}"`);
    return;
  }
  if (board.Dealer && board.Dealer !== value[0]) {
    report(where, `Auction starts with ${value[0]} but Dealer says ${board.Dealer}`);
  }

  const legal = /^(Pass|X|XX|[1-7](C|D|H|S|NT)|AP)$/;
  const dealer = SEATS.indexOf(value[0]);
  const firstBidBy = new Map();
  let lastBid = null;

  tokens.forEach((token, index) => {
    if (!legal.test(token)) {
      report(where, `"${token}" is not a legal bid`);
      return;
    }
    const denomination = /^[1-7](C|D|H|S|NT)$/.exec(token)?.[1];
    if (!denomination) return;
    lastBid = token;
    if (!firstBidBy.has(denomination)) {
      firstBidBy.set(denomination, SEATS[(dealer + index) % 4]);
    }
  });

  const declared = board.Contract;
  if (!declared || declared === 'Pass') return;

  const level = declared[0];
  const denomination = declared.slice(1).replace(/X+$/, '');
  if (lastBid && lastBid !== level + denomination) {
    report(where, `Contract "${declared}" does not match the last bid "${lastBid}"`);
  }

  const declarer = firstBidBy.get(denomination);
  if (board.Declarer && declarer && board.Declarer !== declarer) {
    report(where, `Declarer ${board.Declarer} did not bid ${denomination} first; ${declarer} did`);
  }
}

function checkBoard(lines, path) {
  const board = { tags: [], lines: [] };

  for (const line of lines) {
    const text = line.content.trim();
    if (text === '' || text.startsWith(';') || text.startsWith('%')) continue;

    const tag = text.match(/^\[\s*([A-Za-z0-9_]+)\s*"([^"]*)"\s*\]$/);
    if (tag) {
      board.tags.push(tag[1]);
      board[tag[1]] = tag[2];
      board.lines.push([]);
      continue;
    }

    if (board.lines.length === 0) {
      report(`${path}:${line.number}`, `text before the first tag: "${text}"`);
      continue;
    }
    board.lines[board.lines.length - 1].push(text);
  }

  const label = `${path}:${board.Board ? ` board ${board.Board}` : ' board'}`;

  if (board.Dealer && !SEATS.includes(board.Dealer)) {
    report(label, `Dealer "${board.Dealer}" is not one of N, E, S, W`);
  }
  if (board.Vulnerable && !VULNERABILITIES.includes(board.Vulnerable)) {
    report(label, `Vulnerable "${board.Vulnerable}" is not a known value`);
  }
  if (!board.Deal) {
    report(label, 'no Deal tag');
  } else {
    parseDeal(board.Deal, label);
  }

  const auctionIndex = board.tags.indexOf('Auction');
  if (auctionIndex >= 0) {
    parseAuction(board.Auction, board.lines[auctionIndex] ?? [], label, board);
  } else if (board.Contract) {
    report(label, 'Contract without an Auction');
  }
}

function main() {
  const args = process.argv.slice(2);
  const files = args.filter((arg) => !arg.startsWith('-'));
  const quiet = args.includes('--quiet');

  if (files.length === 0) {
    files.push('-');
  }

  let boards = 0;

  for (const file of files) {
    let text;
    try {
      text = readFileSync(file === '-' ? 0 : file, 'utf8');
    } catch (error) {
      console.error(`cannot read ${file}: ${error.message}`);
      process.exit(2);
    }

    const lines = text.split(/\r?\n/).map((content, index) => ({
      content,
      number: index + 1,
    }));

    // Boards are separated by blank lines, but a tag line always starts a new
    // tag, so a blank line inside an auction does not split a board.
    let chunk = [];
    const flush = () => {
      const hasTag = chunk.some((line) => /^\s*\[/.test(line.content));
      if (hasTag) {
        boards += 1;
        checkBoard(chunk, file === '-' ? '<stdin>' : file);
      }
      chunk = [];
    };

    for (const line of lines) {
      if (/^\s*$/.test(line.content)) {
        flush();
        continue;
      }
      chunk.push(line);
    }
    flush();
  }

  if (problems.length === 0) {
    if (!quiet) {
      const label = boards === 1 ? 'board' : 'boards';
      console.log(`ok: ${boards} ${label} checked`);
    }
    return 0;
  }

  for (const problem of problems) console.error(problem);
  console.error(`${problems.length} problem(s) in ${boards} board(s)`);
  return 1;
}

process.exit(main());
