# Contributing to smart-storage-ttl-core

First off, thank you for considering contributing to `smart-storage-ttl-core`! It's people like you that make open-source software such a great community.

## Getting Started

1. **Open an Issue First:** If you are planning to add a major new feature, please open an Issue to discuss it with the maintainers before writing any code. We want to make sure it aligns with the project's lightweight vision before you spend your valuable time on it!
2. **Fork the repository** and clone it to your local machine.
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Create a new branch** for your feature or bug fix:
   ```bash
   git checkout -b feature/my-awesome-feature
   ```

## Development Workflow

### 1. Code Style

We use ESLint and Prettier to keep the codebase clean and consistent. Before committing your changes, please run:

```bash
npm run format
npm run lint
```

### 2. Testing

We pride ourselves on maintaining **100% test coverage**. If you add a new feature or fix a bug, please add a corresponding test in `index.test.js`, `react.test.js`, or `vue.test.js`.

You can run the test suite and view the coverage report by running:

```bash
npm run test:coverage
```

### 3. Committing Your Changes (Important!)

This project uses `semantic-release` to automate version bumping and NPM publishing. **Please do not use standard `git commit` commands.**

Instead, stage your files and run our interactive commit wizard:

```bash
git add .
npm run commit
```

Follow the prompts to describe your changes. This ensures your commit message is formatted perfectly for our automated release pipeline!

## Opening a Pull Request

1. Push your branch to your fork on GitHub.
2. Open a Pull Request against the `main` branch of this repository.
3. Fill out the Pull Request Template checklist.
4. Wait for the automated CI/CD pipeline to run your tests.

Thank you for your contribution!
