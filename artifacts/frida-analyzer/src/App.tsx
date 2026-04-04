import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import Home from "@/pages/home";
import BinaryAnalyzer from "@/pages/binary-analyzer";
import HexViewer from "@/pages/hex-viewer";
import Scripts from "@/pages/scripts";
import Device from "@/pages/device";
import BinaryDiff from "@/pages/binary-diff";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/binary" component={BinaryAnalyzer} />
        <Route path="/diff" component={BinaryDiff} />
        <Route path="/hex" component={HexViewer} />
        <Route path="/scripts" component={Scripts} />
        <Route path="/device" component={Device} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
