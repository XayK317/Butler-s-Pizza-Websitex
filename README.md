The beginning collaboration between partners, this is used to officialize the repo and add collaborants.

## Stylesheets

Edit `butlers-pizza/styles.scss` for shared site styles and the matching page `.scss` file for page-specific styles. The HTML pages load the compiled shared stylesheet and their own compiled page stylesheet.

After installing dependencies with `npm install`, run `npm run build:css` to compile the Sass files to CSS.

## Form submissions

The catering inquiry and job application forms use FormSubmit to deliver submissions to the Butler's Pizza mailbox. Before form submissions can be delivered, the mailbox owner must complete FormSubmit's one-time activation from the confirmation email. The address submitted in each form is used as the reply-to address; the message itself is sent through FormSubmit. Job applications include the applicant's date of birth.