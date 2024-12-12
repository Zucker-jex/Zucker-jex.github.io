---
title: Deep Learning with TensorFlow - Second Edition
key: 使用TensorFlow
tags: ["Translate"]
aside:
    toc: true
---

使用 TensorFlow 进行深度学习 - 第二版 <!--more-->

![Image](../../assets/images/Translator/Deep%20Learning%20with%20TensorFlow%20-%20Second%20Edition.jpeg){:.shadow}

## 关于

### 作者

Giancarlo Zaccone & Md. Rezaul Karim

### 译者

Google翻译

## 译文摘抄

Chapter 1. Getting Started with Deep Learning\
第 1 章深度学习入门

This chapter explains some of the basic concepts of Machine Learning (ML) and Deep Learning (DL) that will be used in all the subsequent chapters. We will start with a brief introduction to ML. Then we will move to DL, which is a branch of ML based on a set of algorithms that attempt to model high-level abstractions in data.\
本章解释了机器学习（ML）和深度学习（DL）的一些基本概念，这些概念将在后续所有章节中使用。我们首先简要介绍 ML。然后我们将转向深度学习，它是机器学习的一个分支，基于一组试图对数据中的高级抽象进行建模的算法。

We will briefly discuss some of the most well-known and widely used neural network architectures, before moving on to coding with TensorFlow in Chapter 2, A First Look at TensorFlow. In this chapter, we will look at various features of DL frameworks and libraries, such as the native language of the framework, multi-GPU support, and aspects of usability.\
我们将简要讨论一些最著名和最广泛使用的神经网络架构，然后在第 2 章“初探 TensorFlow”中使用 TensorFlow 进行编码。在本章中，我们将了解 DL 框架和库的各种功能，例如框架的本机语言、多 GPU 支持以及可用性方面。

In a nutshell, the following topics will be covered:\
简而言之，将涵盖以下主题：

A soft introduction to ML\
ML 的软介绍

Artificial neural networks\
人工神经网络

ML versus DL\
机器学习与深度学习

DL neural network architectures\
深度学习神经网络架构

Available DL frameworks\
可用的深度学习框架

A soft introduction to machine learning\
机器学习的软介绍

ML is about using a set of statistical and mathematical algorithms to perform tasks such as concept learning, predictive modeling, clustering, and mining useful patterns. The ultimate goal is to improve the learning in such a way that it becomes automatic, so that no more human interactions are needed, or at least to reduce the level of human interaction as much as possible.\
ML 是使用一组统计和数学算法来执行概念学习、预测建模、聚类和挖掘有用模式等任务。最终目标是改进学习，使其变得自动化，从而不再需要人类交互，或者至少尽可能降低人类交互的水平。

We now refer to a famous definition of ML by Tom M. Mitchell (Machine Learning, Tom Mitchell, McGraw Hill), where he explained what learning really means from a computer science perspective:\
现在我们参考 Tom M. Mitchell（《机器学习》、Tom Mitchell、McGraw Hill）对 ML 的著名定义，他从计算机科学的角度解释了学习的真正含义：

"A computer program is said to learn from experience E with respect to some class of tasks T and performance measure P, if its performance at tasks in T, as measured by P, improves with experience E."\
“如果计算机程序在 T 中的任务中的性能（由 P 测量）随着经验 E 的提高而提高，则可以说，计算机程序可以从关于某类任务 T 和性能测量 P 的经验 E 中学习。”

Based on this definition, we can conclude that a computer program or machine can do the following:\
根据这个定义，我们可以得出结论，计算机程序或机器可以执行以下操作：

Learn from data and histories called training data\
从称为训练数据的数据和历史中学习

Improve with experience\
通过经验改进

Interactively enhance a model that can be used to predict outcomes of questions\
交互式增强可用于预测问题结果的模型

Almost every machine-learning algorithm we use can be treated as an optimization problem. This is about finding parameters that minimize some objective function, such as a weighted sum of two terms such as a cost function and regularization (log-likelihood and log-prior, respectively, in statistics).\
几乎我们使用的每一种机器学习算法都可以被视为优化问题。这是关于寻找最小化某些目标函数的参数，例如成本函数和正则化（统计中分别为对数似然和对数先验）等两项的加权和。

Typically, an objective function has two components: a regularizer, which controls the complexity of the model, and the loss, which measures the error of the model on the training data (we’ll look into the details).\
通常，目标函数有两个组成部分：正则化器，它控制模型的复杂性；损失，它测量模型在训练数据上的误差（我们将研究细节）。

On the other hand, the regularization parameter defines the trade-off between the two goals of minimizing the loss of the training error and of minimizing the model's complexity in an effort to avoid overfitting. Now if both of these components are convex, then their sum is also convex; else it is nonconvex.\
另一方面，正则化参数定义了最小化训练误差损失和最小化模型复杂性以避免过度拟合这两个目标之间的权衡。现在，如果这两个分量都是凸的，那么它们的和也是凸的；否则它是非凸的。

## 下载

- [EPUB](https://zuckertech-my.sharepoint.com/:u:/g/personal/jex_zuckertech_onmicrosoft_com/EZEOyEvRbX9Ohpl-AfXYaDwBBvUFeAKxDPJNzfsAM6LGdg?e=anGcMB)
