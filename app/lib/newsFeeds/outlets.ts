/** Outlet list per SPEC_news_threshold.md §1.2 */

export type NewsBucket = 'left' | 'center' | 'right'

export interface OutletDefinition {
  id: string
  name: string
  bucket: NewsBucket
  /** Primary URL first, then spec-noted variants. */
  urls: string[]
  /** Google News RSS — run redirect resolution on sample items. */
  googleNews?: boolean
}

export const OUTLET_LIST_VERSION = '2026-07-06'

/** Pre-verified L-bucket alternate per §1.3 */
export const NBC_NEWS_SUBSTITUTE: OutletDefinition = {
  id: 'nbc-news',
  name: 'NBC News (substitute)',
  bucket: 'left',
  urls: ['https://feeds.nbcnews.com/nbcnews/public/news'],
}

export const NEWS_OUTLETS: OutletDefinition[] = [
  {
    id: 'nyt',
    name: 'The New York Times (News)',
    bucket: 'left',
    urls: ['https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml'],
  },
  {
    id: 'wapo',
    name: 'The Washington Post',
    bucket: 'left',
    urls: [
      'https://feeds.washingtonpost.com/rss/politics',
      'https://feeds.washingtonpost.com/rss/national',
    ],
  },
  {
    id: 'npr',
    name: 'NPR',
    bucket: 'left',
    urls: ['https://feeds.npr.org/1001/rss.xml'],
  },
  {
    id: 'ap',
    name: 'Associated Press',
    bucket: 'left',
    urls: [
      'https://news.google.com/rss/search?q=site:apnews.com+when:1d&hl=en-US&gl=US&ceid=US:en',
    ],
    googleNews: true,
  },
  {
    id: 'reuters',
    name: 'Reuters',
    bucket: 'center',
    urls: [
      'https://news.google.com/rss/search?q=site:reuters.com+when:1d&hl=en-US&gl=US&ceid=US:en',
    ],
    googleNews: true,
  },
  {
    id: 'bbc',
    name: 'BBC News',
    bucket: 'center',
    urls: ['https://feeds.bbci.co.uk/news/rss.xml'],
  },
  {
    id: 'the-hill',
    name: 'The Hill',
    bucket: 'center',
    urls: ['https://thehill.com/news/feed/'],
  },
  {
    id: 'wsj',
    name: 'The Wall Street Journal (News)',
    bucket: 'center',
    urls: ['https://feeds.a.dj.com/rss/RSSWorldNews.xml'],
  },
  {
    id: 'fox-news',
    name: 'Fox News',
    bucket: 'right',
    urls: ['https://moxie.foxnews.com/google-publisher/latest.xml'],
  },
  {
    id: 'national-review',
    name: 'National Review (News)',
    bucket: 'right',
    urls: ['https://www.nationalreview.com/feed/'],
  },
  {
    id: 'washington-examiner',
    name: 'Washington Examiner',
    bucket: 'right',
    urls: ['https://www.washingtonexaminer.com/feed/'],
  },
  {
    id: 'the-dispatch',
    name: 'The Dispatch',
    bucket: 'right',
    urls: ['https://thedispatch.com/feed/'],
  },
]
