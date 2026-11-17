export class ProfileController {
  #profiles;

  constructor({ profileService }) {
    this.#profiles = profileService;
  }

  update = async (req, res) => {
    res.json({ user: await this.#profiles.update(req.user, req.body) });
  };

  changePassword = async (req, res) => {
    res.json({ user: await this.#profiles.changePassword(req.user, req.body) });
  };

  uploadAvatar = async (req, res) => {
    const bytes = Buffer.isBuffer(req.body) ? req.body : null;
    res.json({ user: await res.locals.timing.measure('avatar', () => this.#profiles.setAvatar(req.user, bytes), 'worker EXIF') });
  };

  removeAvatar = async (req, res) => {
    res.json({ user: await this.#profiles.removeAvatar(req.user) });
  };
}
