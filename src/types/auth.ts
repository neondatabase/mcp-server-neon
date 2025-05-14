export type AuthContext = {
  accessToken: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  client: {
    id: string;
    name: string;
  };
};
