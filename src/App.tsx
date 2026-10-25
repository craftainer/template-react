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
import { AdminPage } from "./pages/AdminPage";

function App() {
  const auth = useAuth();

  return (
    <>
      <AppBar position="static" elevation={0}>
        <Toolbar>
          <Typography variant="h6" component="h1" noWrap sx={{ flexGrow: 1 }}>
            template-react
          </Typography>
          <Stack
            direction="row"
            spacing={{ xs: 1, sm: 2 }}
            sx={{ alignItems: "center", flexShrink: 0 }}
          >
            <HealthStatus />
            {auth.isAuthenticated ? (
              <>
                <Typography
                  variant="body2"
                  noWrap
                  sx={{ maxWidth: { xs: "6rem", sm: "none" } }}
                >
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
                sx={{ whiteSpace: "nowrap" }}
              >
                Sign in
              </Button>
            )}
          </Stack>
        </Toolbar>
      </AppBar>

      <Container component="main" maxWidth="lg" sx={{ py: 4 }}>
        {auth.isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress aria-label="Loading" />
          </Box>
        ) : auth.isAuthenticated ? (
          <AdminPage />
        ) : (
          <Typography color="text.secondary">
            Sign in to view and manage records.
          </Typography>
        )}
      </Container>
    </>
  );
}

export default App;
