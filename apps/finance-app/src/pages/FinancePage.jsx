import IframeViewer from '../components/IframeViewer'

const FINANCE_URL = 'https://www.jtamerius.com/finance/'

export default function FinancePage() {
  return <IframeViewer src={FINANCE_URL} title="Finance Tracker" />
}
