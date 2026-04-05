import IframeViewer from '../components/IframeViewer'

const WEATHER_URL = 'https://jtamerius.com/weather/'

export default function WeatherPage() {
  return <IframeViewer src={WEATHER_URL} title="Ensemble Weather Forecast" />
}
