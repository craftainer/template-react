import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { useAuth } from "react-oidc-context";
import { HealthStatus } from "./components/HealthStatus";
import { HeroesPage } from "./pages/HeroesPage";

function App() {
  const auth = useAuth();

  return (
    <>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            template-react
          </Typography>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <HealthStatus />
            {auth.isAuthenticated ? (
              <>
                <Typography variant="body2">
                  {auth.user?.profile.preferred_username}
                </Typography>
                <Button size="small" onClick={() => auth.removeUser()}>
                  Sign out
                </Button>
              </>
            ) : (
              <Button
                size="small"
                variant="outlined"
                onClick={() => auth.signinRedirect()}
              >
                Sign in
              </Button>
            )}
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth="md" sx={{ py: 4 }}>
        {auth.isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : auth.isAuthenticated ? (
          <HeroesPage />
        ) : (
          <Typography color="text.secondary">
            Sign in to view and manage heroes.
          </Typography>
        )}
      </Container>
    </>
  );
}

export default App;
