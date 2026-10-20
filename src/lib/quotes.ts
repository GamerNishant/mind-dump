import { daysFrom } from './plan'

export interface Quote {
  text: string
  author: string
}

/**
 * A small, offline set of well-attributed quotes about work, focus and consistency.
 * One is shown per planner day (see quoteOfDay), so everyone sees the same one on the same day.
 */
export const QUOTES: readonly Quote[] = [
  { text: 'We are what we repeatedly do.', author: 'Will Durant, on Aristotle' },
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain (attributed)' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', author: 'Confucius (attributed)' },
  { text: 'You do not rise to the level of your goals. You fall to the level of your systems.', author: 'James Clear' },
  { text: 'Every action you take is a vote for the type of person you wish to become.', author: 'James Clear' },
  { text: 'Missing once is an accident. Missing twice is the start of a new habit.', author: 'James Clear' },
  { text: 'How we spend our days is, of course, how we spend our lives.', author: 'Annie Dillard' },
  { text: 'Well begun is half done.', author: 'Aristotle (attributed)' },
  { text: 'The journey of a thousand miles begins with one step.', author: 'Lao Tzu' },
  { text: 'Action is the foundational key to all success.', author: 'Pablo Picasso (attributed)' },
  { text: 'Amateurs sit and wait for inspiration, the rest of us just get up and go to work.', author: 'Stephen King' },
  { text: 'Discipline is choosing between what you want now and what you want most.', author: 'Augusta F. Kantra (attributed)' },
  { text: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci (attributed)' },
  { text: 'Focus is a matter of deciding what things you are not going to do.', author: 'John Carmack' },
  { text: 'Do what you can, with what you have, where you are.', author: 'Theodore Roosevelt' },
  { text: 'It always seems impossible until it is done.', author: 'Nelson Mandela (attributed)' },
  { text: 'Arise, awake, and stop not till the goal is reached.', author: 'Swami Vivekananda' },
  { text: 'You have a right to your actions, but never to the fruits of your actions.', author: 'Bhagavad Gita 2.47' },
  { text: 'Be the change that you wish to see in the world.', author: 'Mahatma Gandhi (paraphrase)' },
  { text: 'Dream is not that which you see while sleeping; it is something that does not let you sleep.', author: 'A. P. J. Abdul Kalam' },
  { text: 'If you fail, never give up, because F.A.I.L. means First Attempt In Learning.', author: 'A. P. J. Abdul Kalam' },
  { text: 'Waste no more time arguing about what a good man should be. Be one.', author: 'Marcus Aurelius' },
  { text: 'You could leave life right now. Let that determine what you do and say and think.', author: 'Marcus Aurelius' },
  { text: 'The impediment to action advances action. What stands in the way becomes the way.', author: 'Marcus Aurelius' },
  { text: 'We suffer more often in imagination than in reality.', author: 'Seneca' },
  { text: 'It is not that we have a short time to live, but that we waste a lot of it.', author: 'Seneca' },
  { text: 'First say to yourself what you would be; and then do what you have to do.', author: 'Epictetus' },
  { text: 'No man is free who is not master of himself.', author: 'Epictetus' },
  { text: 'Nothing will work unless you do.', author: 'Maya Angelou' },
  { text: 'Done is better than perfect.', author: 'Unknown' },
  { text: 'Perfect is the enemy of good.', author: 'Voltaire' },
  { text: 'The best time to plant a tree was 20 years ago. The second best time is now.', author: 'Proverb' },
  { text: 'Small deeds done are better than great deeds planned.', author: 'Peter Marshall' },
  { text: 'Motivation is what gets you started. Habit is what keeps you going.', author: 'Jim Ryun (attributed)' },
  { text: 'Success is the sum of small efforts, repeated day in and day out.', author: 'Robert Collier' },
  { text: 'Either you run the day or the day runs you.', author: 'Jim Rohn' },
  { text: 'Lost time is never found again.', author: 'Benjamin Franklin' },
  { text: 'Energy and persistence conquer all things.', author: 'Benjamin Franklin' },
  { text: "Don't watch the clock; do what it does. Keep going.", author: 'Sam Levenson' },
  { text: 'The way to get started is to quit talking and begin doing.', author: 'Walt Disney' },
  { text: 'Courage is not having the strength to go on; it is going on when you don’t have the strength.', author: 'Unknown' },
  { text: 'I am not afraid of storms, for I am learning how to sail my ship.', author: 'Louisa May Alcott' },
  { text: 'Knowing is not enough; we must apply. Willing is not enough; we must do.', author: 'Johann Wolfgang von Goethe' },
  { text: 'A year from now you may wish you had started today.', author: 'Karen Lamb' },
  { text: 'Inspiration exists, but it has to find you working.', author: 'Pablo Picasso' },
  { text: 'Concentrate all your thoughts upon the work at hand.', author: 'Alexander Graham Bell' },
  { text: 'Genius is one percent inspiration and ninety-nine percent perspiration.', author: 'Thomas Edison' },
  { text: 'I have not failed. I’ve just found 10,000 ways that won’t work.', author: 'Thomas Edison (attributed)' },
  { text: 'The man who moves a mountain begins by carrying away small stones.', author: 'Proverb' },
  { text: 'Slow and steady wins the race.', author: 'Aesop' },
  { text: 'You miss 100% of the shots you don’t take.', author: 'Wayne Gretzky' },
  { text: 'Quality is not an act, it is a habit.', author: 'Will Durant, on Aristotle' },
  { text: 'Starve your distractions, feed your focus.', author: 'Unknown' },
  { text: 'One day or day one. You decide.', author: 'Unknown' },
  { text: 'Clarity comes from action, not thought.', author: 'Marie Forleo' },
  { text: 'Hard choices, easy life. Easy choices, hard life.', author: 'Jerzy Gregorek' },
  { text: 'The successful warrior is the average man, with laser-like focus.', author: 'Bruce Lee (attributed)' },
  { text: 'Rest when you’re weary. Refresh and renew yourself.', author: 'Ralph Marston' },
  { text: 'What you do every day matters more than what you do once in a while.', author: 'Gretchen Rubin' },
  { text: 'Make each day your masterpiece.', author: 'John Wooden' },
]

/** The quote for a planner day: stable for the whole day, and different on consecutive days. */
export function quoteOfDay(day: string): Quote {
  const n = daysFrom('2026-01-01', day)
  const index = ((n * 37) % QUOTES.length + QUOTES.length) % QUOTES.length
  return QUOTES[index]
}
