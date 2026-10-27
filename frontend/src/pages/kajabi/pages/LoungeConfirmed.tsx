import { Link } from "react-router";
import { Seo } from "@/components/Seo";
import "./LoungeConfirmed.css";

export default function LoungeConfirmed() {
  return <>
    <Seo title="You're Officially in the Lounge! | Boss Clinician" noindex />
    <article className="lounge-welcome">
      <div className="lounge-welcome-layout">
        <div className="lounge-welcome-copy">
          <header>
            <h1>You’re Officially<br />in the Lounge!</h1>
            <p className="lounge-welcome-lede">You just made a decision about how your practice runs from here. Here's exactly what happens next.</p>
          </header>
          <ol className="lounge-welcome-steps">
            <li>
              <h2>Step 1: Check your email</h2>
              <p>Look for your confirmation and login details in your inbox. Can't find them? Check spam or promotions, and add <a href="mailto:support@bossclinician.com">support@bossclinician.com</a> to your contacts so nothing from the Lounge gets lost.</p>
            </li>
            <li>
              <h2>Step 2: Log in and go to Start Here</h2>
              <p>Your first stop inside the Lounge is your Practice Elevation course with the Start Here module. It takes about 30 minutes and ends with your Practice Reset Snapshot and your Practice Health Assessment baseline: your exact starting point, your first five moves, and the “before” picture we'll measure your transformation against.</p>
              <Link className="lounge-welcome-button" to="/library/the-practice-elevation">Open The Practice Elevation</Link>
            </li>
            <li>
              <h2>Step 3: Introduce yourself in the Lounge Community</h2>
              <p>Find The Lounge community in your library. Post your name, your specialty, and the one thing you most want to change about how your practice runs. This is not just a group. It's your growth circle, and every clinician in it knows exactly what it means to be fully booked and still running on empty.</p>
              <Link to="/library">Go to your library</Link>
            </li>
          </ol>
          <aside className="lounge-welcome-vip" aria-labelledby="lounge-vip-title">
            <h2 id="lounge-vip-title">Joined as a VIP?</h2>
            <p>If you joined as a VIP, open your VIP Access portal to book your Kickoff Call — it happens in your first two weeks, and your Snapshot results become our agenda.</p>
            <Link to="/library/the-lounge-vip">Open your VIP Access portal</Link>
          </aside>
          <div className="lounge-welcome-closing">
            <p>You built the full practice. That was the hard part, and you did it. The Lounge is where it starts paying you like it: your rates, your time, your terms.</p>
            <p>We're glad you're here. Let's elevate.</p>
            <p><strong>See you inside the Lounge!</strong><br />— Yvette</p>
          </div>
        </div>
        <img className="lounge-welcome-portrait" src="/images/kajabi-pages/lounge-confirmed/yvette.webp" alt="Yvette Howard, your Lounge coach" width={404} height={847} />
      </div>
    </article>
  </>;
}
