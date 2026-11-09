# Exam Room (MnemoNexus add-on engine)

Practise the written exam. Answer past-paper style questions, design the experiment and read the data under a timer, then mark
yourself against the scheme and the model answer.

The engine shows a question, takes a written answer, and marks it against a scheme with a model answer. Activities, figures and
sources are data files.

## What is, and is not, in this repository

This repository is the **engine and its tests**. It does **not** include any practice content: the activities that
drive it were written from university course material (lecture slides, worksheets and past papers), which is not ours
to publish, so `content/ and sources/` is deliberately empty. Without content the add-on shows nothing to practise, and
tests that load content will not pass. To use the engine, write your own activities for your own subject.

It is built with the [MnemoNexus add-on kit](https://github.com/mnemonexus/mnx-addon-kit). The scripts expect the kit
checked out as a sibling folder named `mnx-addon-kit-release`; adjust the paths in `package.json` if you keep it elsewhere.

## Licence

MIT, see [LICENSE](LICENSE).
