import { retryTiming } from './retry'

// tests exercise the retry paths; keep the waits short
retryTiming.delays = [5, 10, 20]
retryTiming.max = 50
