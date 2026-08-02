/**
 * Turning whatever the user gives us into plain JD text.
 *
 * Three inputs: pasted text, an uploaded file (PDF/DOCX/plain text), or a link to a
 * job posting.
 *
 * The URL path follows the approach in `CarrerPilot-resume`
 * (backend/utils/jd_parser.py) — browser User-Agent, prefer a main-content container,
 * fall back to the whole page, normalise whitespace. Reimplemented in TypeScript rather
 * than run as a Python service: web scraping is not a torch network, and the reasoning
 * that made `ml/serve.py` worth a second process (a policy that cannot be safely
 * reimplemented) does not apply here. See REFERENCES.md.
 */

const MAX_JD_CHARS = 40_000
const MIN_JD_CHARS = 80
const FETCH_TIMEOUT_MS = 12_000

/** Browser UA — most job boards return 403 to an obvious bot. */
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

export class JDExtractionError extends Error {}

// ─── Pasted text ───────────────────────────────────────────────────────────

/**
 * Collapse runs of spaces and blank lines, but keep single line breaks: a JD's
 * bullet structure is information the field extractor and the interviewer both use.
 */
export function cleanPastedJD(text: string): string {
  if (!text || !text.trim()) {
    throw new JDExtractionError('Job description cannot be empty.')
  }
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_JD_CHARS)
}

// ─── URL ───────────────────────────────────────────────────────────────────

/**
 * Block requests to anything that is not a public host.
 *
 * Without this the server will fetch any address the user types, including the cloud
 * provider's metadata endpoint and anything else on the private network — the classic
 * SSRF hole. Harmless on a laptop, not harmless once Phase 7 deploys this.
 *
 * DNS can still resolve a public name to a private address, which this does not catch.
 * The remaining exposure is a GET whose body is returned as text, so the realistic
 * worst case is reading an internal page, not writing anything.
 */
function assertPublicUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new JDExtractionError('That does not look like a valid link.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new JDExtractionError('Only http and https links are supported.')
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  const blocked =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^f[cd][0-9a-f]{2}:/i.test(host) ||
    /^fe80:/i.test(host)

  if (blocked) {
    throw new JDExtractionError('That link points to a private address and cannot be fetched.')
  }
  return url
}

const NOISE_TAGS = ['script', 'style', 'noscript', 'template', 'svg', 'head', 'nav', 'header', 'footer', 'aside']

const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', bull: '•',
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => HTML_ENTITIES[name.toLowerCase()] ?? m)
}

/**
 * HTML to readable text, without adding a DOM parser to the project.
 *
 * Regex is the wrong tool for *understanding* HTML, but this only needs to throw the
 * markup away. Noise tags go first with their contents; block-level tags become line
 * breaks so the JD's bullets survive; everything else is dropped.
 */
export function htmlToText(html: string): string {
  let s = html
  for (const tag of NOISE_TAGS) {
    s = s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ')
    s = s.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), ' ')
  }
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|ul|ol|table)>/gi, '\n')
  s = s.replace(/<(br|hr)\b[^>]*\/?>/gi, '\n')
  s = s.replace(/<li\b[^>]*>/gi, '\n• ')
  s = s.replace(/<[^>]+>/g, ' ')
  s = decodeEntities(s)
  return s
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Pick the page region most likely to be the job description.
 *
 * Job boards nearly always wrap the posting in <main>, <article>, or a container whose
 * class or id mentions "job-description"/"description". A candidate is only accepted if
 * it has real content — a 40-character <main> is a layout shell, not the posting — and
 * otherwise the whole page is used.
 */
function selectJobContent(html: string): string {
  const patterns = [
    /<(main)\b[^>]*>([\s\S]*?)<\/main>/i,
    /<(article)\b[^>]*>([\s\S]*?)<\/article>/i,
    /<(\w+)\b[^>]*(?:class|id)\s*=\s*["'][^"']*job[-_]?description[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i,
    /<(\w+)\b[^>]*(?:class|id)\s*=\s*["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) {
      const text = htmlToText(m[2] ?? '')
      if (text.length > 200) return text
    }
  }
  return htmlToText(html)
}

export async function extractJDFromURL(rawUrl: string): Promise<string> {
  const url = assertPublicUrl(rawUrl)

  let response: Response
  try {
    response = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      // Covers a hung connection as well as a slow one; a promise race would leave
      // the socket open and hold the request handler.
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    throw new JDExtractionError(
      timedOut
        ? 'That job page took too long to respond. Try pasting the text instead.'
        : 'Could not reach that link. Try pasting the job description text instead.'
    )
  }

  if (!response.ok) {
    // The big boards (LinkedIn, Indeed) block automated fetches and require login, so
    // this is the expected outcome there rather than an exceptional one. The message
    // has to point at the paste box, because no amount of retrying will fix it.
    throw new JDExtractionError(
      `That job page returned an error (${response.status}). Many job boards block ` +
      `automated access — please paste the job description text instead.`
    )
  }

  const contentType = response.headers.get('content-type') ?? ''
  const body = await response.text()
  const text = contentType.includes('text/html') ? selectJobContent(body) : htmlToText(body)

  if (text.length < MIN_JD_CHARS) {
    throw new JDExtractionError(
      'That page did not contain readable job text — it may load its content with ' +
      'JavaScript. Please paste the job description instead.'
    )
  }
  return text.slice(0, MAX_JD_CHARS)
}

// ─── File ──────────────────────────────────────────────────────────────────

export async function extractJDFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  const buffer = Buffer.from(await file.arrayBuffer())

  let text = ''
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    // pdf-parse v2 exposes a class, not the v1 default-export function — the same
    // trap that made every resume upload fail before Phase 0.
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    try {
      text = (await parser.getText()).text ?? ''
    } finally {
      await parser.destroy() // without this the route leaks a worker per upload
    }
  } else if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth')
    text = (await mammoth.extractRawText({ buffer })).value ?? ''
  } else if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) {
    text = buffer.toString('utf8')
  } else {
    throw new JDExtractionError('Upload a PDF, DOCX or plain-text file, or paste the text instead.')
  }

  if (text.trim().length < MIN_JD_CHARS) {
    throw new JDExtractionError(
      'Could not read enough text from that file. If it is a scanned image, please ' +
      'paste the job description text instead.'
    )
  }
  return cleanPastedJD(text)
}

export const _internals = { assertPublicUrl, selectJobContent, MIN_JD_CHARS, MAX_JD_CHARS }
