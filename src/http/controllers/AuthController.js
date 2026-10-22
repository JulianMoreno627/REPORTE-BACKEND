export class AuthController {
  #auth;

  constructor({ authService }) {
    this.#auth = authService;
  }

  register = async (req, res) => {
    const { token, user } = await this.#auth.register(req.body ?? {});
    res.status(201).json({ token, user });
  };

  login = async (req, res) => {
    res.json(await this.#auth.login(req.body ?? {}));
  };

  me = (req, res) => {
    res.json({ user: req.user });
  };
}
