import IframeViewer from '../components/IframeViewer'

const WEATHER_URL = 'https://d326hhew368icp.cloudfront.net/weather/'

export default function WeatherPage() {
  return <IframeViewer src={WEATHER_URL} title="Ensemble Weather Forecast" />
}
