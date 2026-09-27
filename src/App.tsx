import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { PushProvider } from "@/contexts/PushContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { FullScreenLoader } from "@/components/ui/Spinner";
import { isSupabaseConfigured } from "@/integrations/supabase/client";
import Index from "@/pages/Index";
import Auth from "@/pages/Auth";
import SetupRequired from "@/pages/SetupRequired";

// Heavier screens load on demand (the map alone is ~1.5 MB).
const MapPage = lazy(() => import("@/pages/MapPage"));
const CreateHapp = lazy(() => import("@/pages/CreateHapp"));
const HappDetail = lazy(() => import("@/pages/HappDetail"));
const Story = lazy(() => import("@/pages/Story"));
const Profile = lazy(() => import("@/pages/Profile"));
const Camera = lazy(() => import("@/pages/Camera"));
const CameraPreview = lazy(() => import("@/pages/CameraPreview"));
const Messages = lazy(() => import("@/pages/Messages"));
const Chat = lazy(() => import("@/pages/Chat"));
const Install = lazy(() => import("@/pages/Install"));
const NotFound = lazy(() => import("@/pages/NotFound"));

const protect = (el: JSX.Element) => <ProtectedRoute>{el}</ProtectedRoute>;

function ThemedToaster() {
  const { mode } = useTheme();
  return (
    <Toaster
      theme={mode}
      position="top-center"
      offset="calc(env(safe-area-inset-top, 0px) + 12px)"
      toastOptions={{
        classNames: {
          toast: "!rounded-2xl !border-border !bg-card !text-card-foreground !shadow-xl",
          description: "!text-muted-foreground",
          actionButton: "!bg-accent !text-accent-foreground !rounded-lg",
        },
      }}
    />
  );
}

export default function App() {
  if (!isSupabaseConfigured) return <SetupRequired />;

  return (
    <ThemeProvider>
      <AuthProvider>
        <PushProvider>
          <BrowserRouter>
            <ThemedToaster />
            <Suspense fallback={<FullScreenLoader />}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/map" element={protect(<MapPage />)} />
                <Route path="/create-happ" element={protect(<CreateHapp />)} />
                <Route path="/happ/:id" element={protect(<HappDetail />)} />
                <Route path="/happ/:id/story/:storyId" element={protect(<Story />)} />
                <Route path="/profile" element={protect(<Profile />)} />
                <Route path="/profile/:userId" element={protect(<Profile />)} />
                <Route path="/camera" element={protect(<Camera />)} />
                <Route path="/camera/preview" element={protect(<CameraPreview />)} />
                <Route path="/messages" element={protect(<Messages />)} />
                <Route path="/messages/:conversationId" element={protect(<Chat />)} />
                <Route path="/install" element={<Install />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </PushProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
