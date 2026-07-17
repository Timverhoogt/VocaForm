import type { WebFormProvider, WebFormQuestionType } from "../adapters/web_form_inspection";

export interface WebFormSpikeFixture {
  name: string;
  provider: WebFormProvider;
  html: string;
  expectedQuestionCount: number;
  expectedTypes: Partial<Record<WebFormQuestionType, number>>;
}

export const WEB_FORM_SPIKE_FIXTURES: WebFormSpikeFixture[] = [
  {
    name: "google-forms-current-page",
    provider: "google_forms",
    expectedQuestionCount: 7,
    expectedTypes: {
      short_text: 1,
      long_text: 1,
      single_choice: 1,
      multi_choice: 1,
      date: 1,
      scale: 1,
      matrix: 1
    },
    html: `<!doctype html>
      <html lang="en">
        <head><title>Community intake</title></head>
        <body>
          <main>
            <h1 role="heading" aria-level="1">Community intake</h1>
            <form action="https://docs.google.com/forms/d/e/example/formResponse" method="post">
              <div role="list">
                <div role="listitem">
                  <h2 role="heading" aria-level="2">Contact details</h2>
                </div>
                <div role="listitem" data-params='%.@.[1001,"Full name","Use the name you prefer.",0,[[2001,null]]]'>
                  <h3 role="heading" aria-level="3">Full name <span aria-label="Required">*</span></h3>
                  <input name="entry.2001" type="text" aria-label="Full name">
                </div>
                <div role="listitem" data-params='%.@.[1002,"Context",null,1,[[2002,null]]]'>
                  <h3 role="heading" aria-level="3">Context</h3>
                  <textarea name="entry.2002" aria-label="Context"></textarea>
                </div>
                <div role="listitem" data-params='%.@.[1003,"Preferred contact",null,2,[[2003,[["Email"],["Phone"]]]]]'>
                  <h3 role="heading" aria-level="3">Preferred contact</h3>
                  <div role="radiogroup" aria-label="Preferred contact">
                    <div role="listitem"><div role="radio" aria-label="Email" data-value="Email"></div></div>
                    <div role="listitem"><div role="radio" aria-label="Phone" data-value="Phone"></div></div>
                  </div>
                  <input name="entry.2003_sentinel" type="hidden">
                </div>
                <div role="listitem" data-params='%.@.[1004,"Support needed",null,4,[[2004,[["Transport"],["Translation"]]]]]'>
                  <h3 role="heading" aria-level="3">Support needed <span>*</span></h3>
                  <div role="checkbox" aria-label="Transport" data-answer-value="Transport"></div>
                  <div role="checkbox" aria-label="Translation" data-answer-value="Translation"></div>
                  <input name="entry.2004_sentinel" type="hidden">
                </div>
                <div role="listitem" data-params='%.@.[1005,"Appointment date",null,9,[[2005,null]]]'>
                  <h3 role="heading" aria-level="3">Appointment date</h3>
                  <input name="entry.2005" type="date" aria-label="Appointment date">
                </div>
                <div role="listitem" data-params='%.@.[1006,"Confidence",null,5,[[2006,[["1"],["2"],["3"]]]]]'>
                  <h3 role="heading" aria-level="3">Confidence</h3>
                  <div role="radiogroup" aria-label="Confidence">
                    <div role="radio" aria-label="1"></div>
                    <div role="radio" aria-label="2"></div>
                    <div role="radio" aria-label="3"></div>
                  </div>
                  <input name="entry.2006_sentinel" type="hidden">
                </div>
                <div role="listitem" data-params='%.@.[1007,"Availability",null,7,[[2007,[["Morning"],["Afternoon"]]]]]'>
                  <h3 role="heading" aria-level="3">Availability</h3>
                  <div role="grid">
                    <div role="radiogroup" aria-label="Monday"><div role="radio" aria-label="Morning"></div></div>
                    <div role="radiogroup" aria-label="Tuesday"><div role="radio" aria-label="Afternoon"></div></div>
                  </div>
                  <input name="entry.2007_sentinel" type="hidden">
                </div>
              </div>
              <button type="button" jsname="OCpkoe">Next</button>
            </form>
          </main>
        </body>
      </html>`
  },
  {
    name: "microsoft-forms-current-page",
    provider: "microsoft_forms",
    expectedQuestionCount: 9,
    expectedTypes: {
      short_text: 1,
      long_text: 1,
      single_choice: 1,
      multi_choice: 1,
      date: 1,
      rating: 1,
      ranking: 1,
      matrix: 1,
      file_upload: 1
    },
    html: `<!doctype html>
      <html lang="en">
        <head><title>Service request</title></head>
        <body>
          <h1 data-automation-id="formTitle">Service request</h1>
          <p data-automation-id="formSubTitle">Tell us what you need.</p>
          <section data-automation-id="questionItem">
            <div data-automation-id="sectionTitle">Your request</div>
            <div id="QuestionId_ms1">
              <div data-automation-id="questionTitle"><h2 role="heading">Reference name</h2></div>
              <span data-automation-id="requiredStar">*</span>
              <div data-automation-id="textInput"><input type="text" aria-label="Reference name"></div>
            </div>
          </section>
          <section data-automation-id="questionItem">
            <div id="QuestionId_ms2">
              <div data-automation-id="questionTitle"><h2 role="heading">Describe the situation</h2></div>
              <div data-automation-id="multilineTextInput"><textarea aria-label="Describe the situation"></textarea></div>
            </div>
          </section>
          <section data-automation-id="questionItem">
            <div id="QuestionId_ms3">
              <div data-automation-id="questionTitle"><h2 role="heading">Contact method</h2></div>
              <div role="radiogroup"><div role="radio" aria-label="Email"></div><div role="radio" aria-label="Phone"></div></div>
            </div>
          </section>
          <section data-automation-id="questionItem">
            <div id="QuestionId_ms4">
              <div data-automation-id="questionTitle"><h2 role="heading">Requested services</h2></div>
              <div role="checkbox" aria-label="Advice"></div><div role="checkbox" aria-label="Transport"></div>
            </div>
          </section>
          <section data-automation-id="questionItem">
            <div id="QuestionId_ms5">
              <div data-automation-id="questionTitle"><h2 role="heading">Preferred date</h2></div>
              <div data-automation-id="dateContainer"><input role="combobox" aria-label="Date picker"></div>
            </div>
          </section>
          <section data-automation-id="questionItem">
            <div id="QuestionId_ms6">
              <div data-automation-id="questionTitle"><h2 role="heading">Urgency</h2></div>
              <div data-automation-id="ratingQuestion"><div role="radio" aria-label="1"></div><div role="radio" aria-label="2"></div></div>
            </div>
          </section>
          <section data-automation-id="questionItem">
            <div id="QuestionId_ms7">
              <div data-automation-id="questionTitle"><h2 role="heading">Rank priorities</h2></div>
              <div data-automation-id="rankingQuestion">
                <div data-automation-id="rankingOption">Speed</div><div data-automation-id="rankingOption">Cost</div>
              </div>
            </div>
          </section>
          <section data-automation-id="questionItem">
            <div id="QuestionId_ms8">
              <div data-automation-id="questionTitle"><h2 role="heading">Availability</h2></div>
              <div data-automation-id="likertQuestion" role="grid">
                <div role="radiogroup" aria-label="Monday"><div role="radio" aria-label="Morning"></div></div>
                <div role="radiogroup" aria-label="Tuesday"><div role="radio" aria-label="Afternoon"></div></div>
              </div>
            </div>
          </section>
          <section data-automation-id="questionItem">
            <div id="QuestionId_ms9">
              <div data-automation-id="questionTitle"><h2 role="heading">Supporting file</h2></div>
              <div data-automation-id="fileUpload"><input type="file"></div>
            </div>
          </section>
          <button type="button" data-automation-id="nextButton">Next</button>
        </body>
      </html>`
  }
];
