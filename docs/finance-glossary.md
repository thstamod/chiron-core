# Finance and research glossary

This glossary explains the financial terms used by Chiron. Definitions are simplified for software
contributors and are not investment advice.

| Term | Meaning in Chiron |
| --- | --- |
| Earnings announcement | A company's periodic update describing revenue, profit, and business developments. |
| Earnings event | Chiron's grouped record for filings and releases describing one reporting period. |
| Fiscal period | The company's accounting quarter or year, which may not match calendar quarters. |
| Revenue | Money generated from selling products or services before subtracting expenses. |
| Revenue growth | Percentage change in comparable revenue versus the same period in the previous year. |
| Net income | Profit remaining after operating costs, interest, taxes, and other included items. |
| Earnings per share (EPS) | Profit attributed to each share under the company's accounting calculation. |
| Basic EPS | EPS using the ordinary weighted-average share count. |
| Diluted EPS | EPS including the possible effect of options, convertible securities, and similar potential shares. |
| GAAP | U.S. Generally Accepted Accounting Principles, the standard basis for reported financial statements. |
| Adjusted or non-GAAP result | A company-defined result excluding selected items. It can aid comparison but is not automatically better or more reliable. |
| Margin | Profit expressed as a percentage of revenue. Different margin types use different profit levels. |
| Net margin | Net income divided by revenue. |
| Operating margin | Operating income divided by revenue, before interest and taxes. |
| Percentage point | The direct difference between two percentages. A margin moving from 15% to 20% improves by 5 percentage points, not 5%. |
| Guidance | Management's forward-looking expectation or range for a future period. |
| Raised guidance | A comparable expected result was increased. Raised expenses are not equivalent to raised revenue or earnings. |
| Maintained guidance | Management explicitly kept a comparable expectation unchanged. |
| Lowered guidance | A comparable expected result was reduced. Its interpretation depends on the metric. |
| Market reaction | The stock-price and volume change after information becomes public. It is separate from the reported business result. |
| Trading session | A day and time window when the stock exchange is open. Chiron counts sessions, not calendar days. |
| Reference or entry price | The versioned price used as the realistic start of an evaluation after analysis was complete. |
| Adjusted price | A provider value adjusted for corporate actions such as stock splits and dividends to make returns more comparable. |
| Return | Price change divided by the entry price. A stored fraction of `0.04` is displayed as 4%. |
| Benchmark | A comparison instrument representing the broad market or a business sector. |
| SPY | An ETF used by Chiron as a practical S&P 500 market proxy. It is not the index itself. |
| Sector ETF | A tradable fund used as an approximate comparison for companies in one sector. |
| Outperformance | The stock return was higher than the benchmark return over the same entry and exit sessions. |
| Excess return | Stock return minus benchmark return. It is a comparison, not a guarantee that the stock made money. |
| Momentum | The tendency or rule based on recent price movement. Chiron treats it as a future comparison baseline, not a proven predictor. |
| Volume | The number of shares traded over a period. |
| Volatility | A measure of how widely returns vary. Higher volatility generally means less stable price movement, not automatically lower returns. |
| Baseline | A simpler method used to test whether a more complex signal adds value. |
| Score | Chiron's transparent `-5` to `+5` rule result. It is not a probability, target price, or buy/sell instruction. |
| Prediction cutoff | The latest timestamp from which information is allowed into a prediction. |
| Future-data leakage | Accidentally using information that became available after the prediction cutoff. It makes historical results unrealistically optimistic. |
| Forward prediction | A prediction frozen before its evaluation period, using information actually available to Chiron. |
| Historical reconstruction | A retrospective simulation using a historical publication cutoff. It is kept separate because outcomes already existed when Chiron reconstructed it. |
| Immutable snapshot | A permanent record of inputs, versions, score, dates, and fingerprints that ordinary updates cannot rewrite. |
| XBRL | Structured tags embedded in SEC reports that identify financial concepts, units, and periods. |
| CIK | The SEC's identifier for a company or filer. It is different from the stock ticker. |
| 8-K | A current report used to disclose material events; earnings releases are often attached as Exhibit 99.1. |
| 10-Q | A quarterly SEC report with financial statements and disclosures. |
| 10-K | An annual SEC report with financial statements, business details, and risk disclosures. |
| Exhibit 99.1 | A common attachment type for a company's earnings press release. |

## Important distinctions

- Strong business results do not guarantee a positive stock return; expectations may already be in
  the price.
- A positive stock return is not necessarily outperformance if the market or sector rose more.
- A correct extraction does not prove the extracted feature predicts returns.
- A historical backtest does not equal a genuine forward track record.
- No risk found in supplied releases does not mean no risk exists.
- A neutral score followed by outperformance is not a successful positive prediction.

