# Starter watchlist

Chiron Core ships with a frozen starter watchlist of 30 large, US-listed SEC filers. The list was
frozen on **2026-11-02**, before later earnings outcomes were observed. It is a reproducible research
configuration, not a list of recommended investments.

The database configuration is created by
[`202611030001_expand_research_universe.sql`](../supabase/migrations/202611030001_expand_research_universe.sql).
That migration also creates the required company price instruments, sector benchmark instruments,
and versioned benchmark assignments.

## How the companies were selected

The starter list follows a few deliberately simple rules:

- Keep the original five companies used while building the ingestion pipeline.
- Add 25 large companies with SEC filings and ordinary US ticker symbols.
- Include all 11 broad market sectors instead of concentrating only on technology.
- Prefer established large companies so filings and daily price observations are normally
  available.
- Include a small special-accounting cohort so the application makes its current limitations
  visible.

These rules are design assumptions for the first experiment. They do not prove that the sample is
representative, statistically sufficient, or likely to produce profitable predictions.

## Frozen benchmark policy

Every company uses `SPY` as its broad US-market comparison. Each company also uses one State Street
Select Sector SPDR ETF as a practical sector comparison.

| Setting | Frozen value |
| --- | --- |
| Mapping version | `benchmark-proxy-v2` |
| Applicable from | `2026-11-02` |
| Market benchmark | `SPY` |
| Price provider symbol | The ticker or ETF symbol shown below |

A benchmark is a comparison point. For example, if a stock gains 4% while `SPY` gains 1% over the
same period, the stock outperformed that market benchmark by 3 percentage points. An ETF is only a
sector proxy here; its holdings and a company's classification can change over time. Chiron keeps
the old mapping version so later changes do not rewrite historical predictions.

## Companies and mappings

`CIK` is the permanent identifier the SEC assigns to a filer. The sector column records the label
stored in Chiron's `companies` table. `AAPL` and `MSFT` retain the earlier `Technology` label, while
their `XLK` mapping places them in the same research group as the companies labeled `Information
Technology`.

| Ticker | SEC legal name | CIK | Exchange | Stored sector | Sector ETF |
| --- | --- | --- | --- | --- | --- |
| AAPL | Apple Inc. | `0000320193` | NASDAQ | Technology | `XLK` |
| MSFT | Microsoft Corporation | `0000789019` | NASDAQ | Technology | `XLK` |
| AMZN | Amazon.com, Inc. | `0001018724` | NASDAQ | Consumer Discretionary | `XLY` |
| GOOGL | Alphabet Inc. | `0001652044` | NASDAQ | Communication Services | `XLC` |
| META | Meta Platforms, Inc. | `0001326801` | NASDAQ | Communication Services | `XLC` |
| NVDA | NVIDIA CORP | `0001045810` | NASDAQ | Information Technology | `XLK` |
| AVGO | Broadcom Inc. | `0001730168` | NASDAQ | Information Technology | `XLK` |
| ORCL | ORACLE CORP | `0001341439` | NYSE | Information Technology | `XLK` |
| CRM | Salesforce, Inc. | `0001108524` | NYSE | Information Technology | `XLK` |
| TMUS | T-Mobile US, Inc. | `0001283699` | NASDAQ | Communication Services | `XLC` |
| DIS | Walt Disney Co | `0001744489` | NYSE | Communication Services | `XLC` |
| TSLA | Tesla, Inc. | `0001318605` | NASDAQ | Consumer Discretionary | `XLY` |
| HD | HOME DEPOT, INC. | `0000354950` | NYSE | Consumer Discretionary | `XLY` |
| MCD | MCDONALDS CORP | `0000063908` | NYSE | Consumer Discretionary | `XLY` |
| WMT | Walmart Inc. | `0000104169` | NASDAQ | Consumer Staples | `XLP` |
| COST | COSTCO WHOLESALE CORP /NEW | `0000909832` | NASDAQ | Consumer Staples | `XLP` |
| PG | PROCTER & GAMBLE Co | `0000080424` | NYSE | Consumer Staples | `XLP` |
| LLY | ELI LILLY & Co | `0000059478` | NYSE | Health Care | `XLV` |
| JNJ | JOHNSON & JOHNSON | `0000200406` | NYSE | Health Care | `XLV` |
| UNH | UNITEDHEALTH GROUP INC | `0000731766` | NYSE | Health Care | `XLV` |
| CAT | CATERPILLAR INC | `0000018230` | NYSE | Industrials | `XLI` |
| GE | GENERAL ELECTRIC CO | `0000040545` | NYSE | Industrials | `XLI` |
| RTX | RTX Corp | `0000101829` | NYSE | Industrials | `XLI` |
| CVX | CHEVRON CORP | `0000093410` | NYSE | Energy | `XLE` |
| COP | CONOCOPHILLIPS | `0001163165` | NYSE | Energy | `XLE` |
| JPM | JPMORGAN CHASE & CO | `0000019617` | NYSE | Financials | `XLF` |
| V | VISA INC. | `0001403161` | NYSE | Financials | `XLF` |
| LIN | LINDE PLC | `0001707925` | NASDAQ | Materials | `XLB` |
| NEE | NEXTERA ENERGY INC | `0000753308` | NYSE | Utilities | `XLU` |
| PLD | Prologis, Inc. | `0001045609` | NYSE | Real Estate | `XLRE` |

The sector ETF symbols mean:

| Symbol | Comparison fund |
| --- | --- |
| `XLK` | Technology Select Sector SPDR Fund |
| `XLC` | Communication Services Select Sector SPDR Fund |
| `XLY` | Consumer Discretionary Select Sector SPDR Fund |
| `XLP` | Consumer Staples Select Sector SPDR Fund |
| `XLV` | Health Care Select Sector SPDR Fund |
| `XLI` | Industrial Select Sector SPDR Fund |
| `XLE` | Energy Select Sector SPDR Fund |
| `XLF` | Financial Select Sector SPDR Fund |
| `XLB` | Materials Select Sector SPDR Fund |
| `XLU` | Utilities Select Sector SPDR Fund |
| `XLRE` | Real Estate Select Sector SPDR Fund |

## Research-group distribution

The counts below use the benchmark classification, which groups the two earlier `Technology`
labels with Information Technology.

| Research group | Companies |
| --- | ---: |
| Information Technology | 6 |
| Communication Services | 4 |
| Consumer Discretionary | 4 |
| Consumer Staples | 3 |
| Health Care | 3 |
| Industrials | 3 |
| Energy | 2 |
| Financials | 2 |
| Materials | 1 |
| Utilities | 1 |
| Real Estate | 1 |
| **Total** | **30** |

## Special-accounting cohort

`JPM`, `UNH`, `NEE`, and `PLD` are useful ingestion and extraction examples, but their accounts need
extra care:

- A bank such as `JPM` depends on concepts including interest income, credit losses, and regulatory
  capital.
- `UNH` combines insurance and health services, where medical-cost measures matter.
- `NEE` combines a regulated utility with energy development and large capital spending.
- `PLD` is a real estate investment trust, where funds from operations and property measures can be
  more useful than ordinary-company net income.

The generic baseline score should not be treated as equally meaningful for this cohort. Any
baseline prediction for one of these companies needs an explicit experimental label and manual
review until sector-aware rules exist.

## Validation and reproduction

Before the list was frozen:

- Company identity, ticker, CIK, and exchange associations were checked against the SEC company
  ticker file.
- Every company and ETF provider symbol returned a valid Tiingo daily-price response during the
  recorded validation on 2026-11-02.
- Sector mappings were checked against the relevant State Street ETF holdings available on
  2026-11-02.
- The list and mapping policy were frozen before later earnings outcomes were observed.

After applying the migrations, validate the stored relationships without changing the database:

```bash
pnpm worker:validate-watchlist
```

The command checks active companies, SEC metadata, Tiingo instruments, and applicable market and
sector assignments. It does not contact SEC or Tiingo, so it cannot prove that an external provider
still recognizes a symbol today. Daily price observations are provider data and are intentionally
not committed to this repository.

The recorded external references were:

- [SEC company tickers and exchanges](https://www.sec.gov/files/company_tickers_exchange.json)
- [State Street Select Sector SPDR ETFs](https://www.ssga.com/us/en/intermediary/capabilities/equities/sector-investing/select-sector-etfs)

