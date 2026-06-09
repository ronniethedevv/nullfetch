import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import { WalletProvider } from './hooks/WalletContext';
import { TopBar } from './components/TopBar';
import { Footer } from './components/Footer';
import { Landing } from './pages/Landing';
import { Browse } from './pages/Browse';
import { ServiceDetail } from './pages/ServiceDetail';
import { Provider } from './pages/Provider';
import { ProviderNew } from './pages/ProviderNew';
import { ProviderService } from './pages/ProviderService';
import { Developer } from './pages/Developer';
import { DeveloperRegister } from './pages/DeveloperRegister';
import { DeveloperService } from './pages/DeveloperService';
import { DocsLanding } from './pages/DocsLanding';
import { DocsProviders } from './pages/DocsProviders';
import { DocsDevelopers } from './pages/DocsDevelopers';

/**
 * Layout shared by every route — top bar, page outlet, footer. The
 * Outlet renders whichever page the router resolved for the URL.
 */
function Layout() {
  return (
    <div className="app">
      <TopBar />
      <main className="main">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/service/:id" element={<ServiceDetail />} />
            <Route path="/docs" element={<DocsLanding />} />
            <Route path="/docs/providers" element={<DocsProviders />} />
            <Route path="/docs/developers" element={<DocsDevelopers />} />
            <Route path="/provider" element={<Provider />} />
            <Route path="/provider/new" element={<ProviderNew />} />
            <Route path="/provider/service/:id" element={<ProviderService />} />
            <Route path="/developer" element={<Developer />} />
            <Route path="/developer/register/:id" element={<DeveloperRegister />} />
            <Route path="/developer/service/:id" element={<DeveloperService />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </WalletProvider>
  );
}
