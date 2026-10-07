import { projectForecast } from './forecastModel.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ result: projectForecast(data.bars, data.horizon, { symbol: data.symbol }) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
