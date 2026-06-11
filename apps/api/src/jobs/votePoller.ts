// Vote poller: a single in-flight timer that fetches the live arena
// JSON at `config.VOTE_POLL_MS` and records a snapshot. On HTTP/network
// failures it backs off exponentially (1 minute → 5 minute cap) and
// never overlaps with itself.

import { config } from "../config.js";
import { fetchLiveVotes, recordPoll } from "../services/votes.js";

const MIN_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;

let timer: NodeJS.Timeout | null = null;
let inFlight = false;
let backoff = config.VOTE_POLL_MS;
let stopRequested = false;

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const got = await fetchLiveVotes();
    if (got) {
      const res = recordPoll(got.votes, got.raw);
      backoff = config.VOTE_POLL_MS; // reset on success
      // eslint-disable-next-line no-console
      console.log(
        `[votePoller] votes=${res.current} delta=${res.delta} observedAt=${res.observedAt}`,
      );
    } else {
      backoff = Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, backoff * 2));
      // eslint-disable-next-line no-console
      console.warn(
        `[votePoller] poll failed; backing off to ${backoff / 1000}s`,
      );
    }
  } catch (err) {
    backoff = Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, backoff * 2));
    // eslint-disable-next-line no-console
    console.warn(
      `[votePoller] poll threw: ${(err as Error).message}; backing off to ${backoff / 1000}s`,
    );
  } finally {
    inFlight = false;
    if (!stopRequested) {
      timer = setTimeout(tick, backoff);
    }
  }
}

/** Start the poller. Idempotent: a second call is a no-op. */
export function startVotePoller(): void {
  if (timer) return;
  stopRequested = false;
  // First tick is immediate so the UI sees a value quickly; thereafter
  // we honour VOTE_POLL_MS (and any backoff).
  void tick();
}

/** Stop the poller. Test helper. */
export function stopVotePoller(): void {
  stopRequested = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Test helper. */
export function pollerState(): {
  running: boolean;
  inFlight: boolean;
  backoff: number;
} {
  return { running: timer !== null, inFlight, backoff };
}
