import { Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence } from "motion/react";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PushProvider } from "@/contexts/PushContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { FullScreenLoader } from "@/components/ui/Spinner";
import { isSupabaseConfigured } from "@/integrations/supabase/client";
import Welcome from "@/pages/Welcome";
import Auth from "@/pages/Auth";
import SetupRequired from "@/pages/SetupRequired";
import { lazyPage } from "@/lib/lazyPage";

const MapPage = lazyPage(() => import("@/pages/MapPage"));
const CreateHapp = lazyPage(() => import("@/pages/CreateHapp"));
const Story = lazyPage(() => import("@/pages/Story"));
const Profile = lazyPage(() => import("@/pages/Profile"));
const Camera = lazyPage(() => import("@/pages/Camera"));
const CameraPreview = lazyPage(() => import("@/pages/CameraPreview"));
const Messages = lazyPage(() => import("@/pages/Messages"));
const Chat = lazyPage(() => import("@/pages/Chat"));
const Install = lazyPage(() => import("@/pages/Install"));
const NotFound = lazyPage(() => import("@/pages/NotFound"));

const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

const MAP_ROUTE = /^\/(map|happ\/[^/]+)\/?$/;

const protect = (el: ReactNode) => <ProtectedRoute>{el}</ProtectedRoute>;

/**
 * The map stays mounted underneath while signed in; every other screen
 * springs in on top of it and springs away to reveal it again. Coming back
 * to the map is instant instead of reloading it each time.
 */
function Shell() {
  const location = useLocation();
  const { user, profile } = useAuth();
  const signedIn = Boolean(user && profile?.username);
  const onMap = MAP_ROUTE.test(location.pathname);

  return (
    <>
      {signedIn && (
        <Suspense fallback={<FullScreenLoader />}>
          <MapPage active={onMap} />
        </Suspense>
      )}

      <AnimatePresence initial={false}>
        <Routes location={location} key={onMap ? "map" : location.pathname}>
          <Route path="/" element={signedIn ? <Navigate to="/map" replace /> : <Welcome />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/map" element={protect(null)} />
          <Route path="/happ/:id" element={protect(null)} />
          <Route path="/happ/:id/story/:storyId" element={protect(<Lazy el={<Story />} />)} />
          <Route path="/create-happ" element={protect(<Lazy el={<CreateHapp />} />)} />
          <Route path="/profile" element={protect(<Lazy el={<Profile />} />)} />
          <Route path="/profile/:userId" element={protect(<Lazy el={<Profile />} />)} />
          <Route path="/camera" element={protect(<Lazy el={<Camera />} />)} />
          <Route path="/camera/preview" element={protect(<Lazy el={<CameraPreview />} />)} />
          <Route path="/messages" element={protect(<Lazy el={<Messages />} />)} />
          <Route path="/messages/:conversationId" element={protect(<Lazy el={<Chat />} />)} />
          <Route path="/install" element={<Lazy el={<Install />} />} />
          <Route path="*" element={<Lazy el={<NotFound />} />} />
        </Routes>
      </AnimatePresence>
    </>
  );
}

function Lazy({ el }: { el: ReactNode }) {
  return <Suspense fallback={null}>{el}</Suspense>;
}

export default function App() {
  if (!isSupabaseConfigured) return <SetupRequired />;

  return (
    <AuthProvider>
      <PushProvider>
        <BrowserRouter basename={basename}>
          <Toaster
            theme="dark"
            position="top-center"
            offset="calc(env(safe-area-inset-top, 0px) + 10px)"
            toastOptions={{
              classNames: {
                toast: "!rounded-full !border-0 !bg-muted !px-5 !py-3.5 !text-foreground !shadow-2xl !font-semibold",
                description: "!text-muted-foreground !font-normal",
                actionButton: "!bg-accent !text-accent-foreground !rounded-full !font-bold",
              },
            }}
          />
          <Shell />
        </BrowserRouter>
      </PushProvider>
    </AuthProvider>
  );
}
